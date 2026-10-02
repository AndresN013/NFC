package ec.marathon.nfcstudio.data.api

import ec.marathon.nfcstudio.BuildConfig
import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.core.atestacion.DeviceAttestationProvider
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Construccion del cliente HTTP.
 *
 * Decisiones que importan:
 *
 *  - La URL base es CONFIGURABLE en caliente (la planta piloto y la nave usan
 *    servidores distintos) y se resuelve en cada peticion mediante
 *    [InterceptorUrlBase]. Se evita reconstruir Retrofit al cambiarla: eso
 *    dejaria peticiones en vuelo apuntando al servidor anterior.
 *  - El token NO aparece en ninguna firma de metodo: lo inyecta
 *    [InterceptorAutorizacion]. Asi es imposible que se cuele en un log de
 *    parametros o en un mensaje de excepcion de Retrofit.
 *  - El registro de red NUNCA usa `Level.BODY`. Ver el comentario en
 *    [interceptorDeRegistro].
 */
object FabricaApi {

    /**
     * `ignoreUnknownKeys`: el servidor puede anadir campos sin tumbar los
     * telefonos ya desplegados en la nave, que no se actualizan el mismo dia.
     * `explicitNulls = false`: no se envian nulos innecesarios, que en los
     * cuerpos con clave de idempotencia cambiarian el hash del cuerpo.
     */
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        isLenient = false
    }

    fun crearClienteOkHttp(
        proveedorToken: () -> String?,
        proveedorAtestacion: DeviceAttestationProvider,
        idDispositivo: () -> String,
        proveedorUrlBase: () -> String,
    ): OkHttpClient = OkHttpClient.Builder()
        // Tiempos cortos: en planta, una operacion que tarda 30 segundos ya
        // detuvo la linea. Es mejor fallar rapido y ofrecer reintentar.
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        // Se desactiva el reintento automatico de OkHttp: los reintentos de las
        // operaciones de escritura los decide el operario, y siempre con la
        // misma clave de idempotencia. Un reintento silencioso de la libreria
        // podria duplicar un efecto con otra conexion.
        .retryOnConnectionFailure(false)
        .addInterceptor(InterceptorUrlBase(proveedorUrlBase))
        .addInterceptor(InterceptorAutorizacion(proveedorToken))
        .addInterceptor(InterceptorDispositivo(idDispositivo))
        .addInterceptor(InterceptorAtestacion(proveedorAtestacion))
        .addInterceptor(interceptorDeRegistro())
        .build()

    fun crearApi(cliente: OkHttpClient): ApiProduccion = Retrofit.Builder()
        // URL de marcador: [InterceptorUrlBase] la reescribe en cada peticion.
        // Retrofit exige una URL valida en construccion.
        .baseUrl("https://api.invalida.local/")
        .client(cliente)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(ApiProduccion::class.java)

    /**
     * Registro de red deliberadamente limitado a `BASIC` (metodo, ruta, codigo,
     * tamano, duracion) y SOLO en compilaciones debug.
     *
     * No se usa `Level.BODY` ni `Level.HEADERS` en ningun caso: el cuerpo del
     * login contiene la contrasena, el de reserva devuelve la URI con el token
     * que se graba en el chip y las cabeceras llevan el token de sesion. Ademas,
     * la linea pasa por [Registro] y por tanto por el redactor, como segunda
     * barrera por si una ruta llevara un identificador sensible.
     */
    private fun interceptorDeRegistro(): HttpLoggingInterceptor =
        HttpLoggingInterceptor { mensaje -> Registro.depuracion("Red", mensaje) }.apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
}

/**
 * Reescribe esquema, host, puerto y prefijo de ruta de cada peticion segun la
 * URL base vigente. Permite cambiar de servidor sin reconstruir Retrofit.
 */
class InterceptorUrlBase(private val proveedorUrlBase: () -> String) : Interceptor {
    override fun intercept(cadena: Interceptor.Chain): Response {
        val original = cadena.request()
        val base = proveedorUrlBase().trim()
        if (base.isEmpty()) return cadena.proceed(original)

        // La ruta de cada endpoint ya es completa ("api/v1/production/..."), asi
        // que basta con concatenar la base con ella. Si la base incluyera un
        // prefijo de ruta (un proxy inverso), tambien se conserva.
        val urlCompuesta = base.trimEnd('/') + "/" + original.url.encodedPath.trimStart('/')
        val nuevaUrl = urlCompuesta.toHttpUrlOrNull()
            ?: return cadena.proceed(original) // URL mal escrita: se deja pasar y falla con claridad

        val conConsulta = nuevaUrl.newBuilder()
            .encodedQuery(original.url.encodedQuery)
            .build()

        return cadena.proceed(original.newBuilder().url(conConsulta).build())
    }
}

/**
 * Anade `Authorization: Bearer <token>` cuando hay sesion.
 *
 * SEGURIDAD: el token se lee del almacen cifrado en cada peticion y no se
 * guarda en ningun campo de esta clase. Si el operario cierra sesion, la
 * siguiente peticion ya sale sin credencial.
 */
class InterceptorAutorizacion(private val proveedorToken: () -> String?) : Interceptor {
    override fun intercept(cadena: Interceptor.Chain): Response {
        val peticion = cadena.request()
        // El login es el unico endpoint que no debe llevar token.
        if (peticion.url.encodedPath.endsWith("/auth/login")) {
            return cadena.proceed(peticion)
        }
        val token = proveedorToken()
        val conCredencial = if (token.isNullOrBlank()) {
            peticion
        } else {
            peticion.newBuilder().header("Authorization", "Bearer $token").build()
        }
        return cadena.proceed(conCredencial)
    }
}

/**
 * Identifica el teléfono en cada peticion.
 *
 * El servidor usa esta cabecera para comprobar que el dispositivo esta
 * autorizado para programar y para dejar constancia en la auditoria de QUE
 * telefono grabo cada chip. El identificador es aleatorio por instalacion: NO
 * es el IMEI ni el ANDROID_ID, que son identificadores persistentes del
 * dispositivo y datos personales.
 */
class InterceptorDispositivo(private val idDispositivo: () -> String) : Interceptor {
    override fun intercept(cadena: Interceptor.Chain): Response =
        cadena.proceed(
            cadena.request().newBuilder()
                .header("X-Device-Id", idDispositivo())
                .header("X-App-Version", BuildConfig.VERSION_NAME)
                .build(),
        )
}

/**
 * PUNTO DE INTEGRACION de Play Integrity.
 *
 * Hoy no hace nada porque [DeviceAttestationProvider] es el implementacion nula.
 * Cuando exista el proveedor real, aqui se anadira la cabecera
 * `X-Integrity-Token` a las operaciones de escritura. Se deja el interceptor
 * montado en la cadena para que ese cambio sea de una sola linea y no obligue a
 * tocar la construccion del cliente.
 *
 * No se anade una cabecera vacia ni un valor de relleno: una cabecera presente
 * pero invalida es peor que su ausencia, porque el servidor no puede distinguir
 * "no soportado" de "manipulado".
 */
class InterceptorAtestacion(
    private val proveedor: DeviceAttestationProvider,
) : Interceptor {
    override fun intercept(cadena: Interceptor.Chain): Response {
        if (!proveedor.disponible) return cadena.proceed(cadena.request())
        // PENDIENTE: obtener el nonce que el servidor emitio en el login o en la
        // reserva del trabajo, pedir el token con proveedor.obtenerToken(nonce)
        // y anadirlo como cabecera X-Integrity-Token.
        return cadena.proceed(cadena.request())
    }
}
