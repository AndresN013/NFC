package ec.marathon.nfcstudio.data.session

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import ec.marathon.nfcstudio.core.Registro
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Almacen del token de sesion.
 *
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Tokens de sesion de corta duracion, en          #
 * # EncryptedSharedPreferences".                                            #
 * ###########################################################################
 *
 * Por que EncryptedSharedPreferences y no SharedPreferences normales: un
 * telefono de planta se pierde, se presta y a veces sale del edificio. Con
 * preferencias en claro, cualquiera con acceso a una copia de seguridad o a un
 * dispositivo con arranque modificado leeria el token y podria programar chips
 * en nombre del operario. Aqui la clave maestra vive en el Keystore de Android,
 * respaldada por hardware cuando el dispositivo lo ofrece, y nunca sale de el.
 *
 * Por que de CORTA DURACION: el token no se renueva de forma silenciosa. Cuando
 * caduca, el operario vuelve a ingresar. Esto acota la ventana de abuso de un
 * token robado a la duracion de un turno como maximo, y obliga a que la
 * identidad de quien programa cada chip sea reciente y explicita.
 *
 * Lo que NO se guarda aqui, y es deliberado:
 *  - La contrasena. Nunca. No hay "recordar contrasena" en esta app.
 *  - Ningun material criptografico de chips. Ver `ReferenciaClave`.
 */
class AlmacenSesion(contexto: Context) {

    private val preferencias: SharedPreferences = run {
        val claveMaestra = MasterKey.Builder(contexto.applicationContext, ALIAS_CLAVE_MAESTRA)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            // No se exige autenticacion de usuario para usar la clave: en planta
            // el operario tiene las manos ocupadas con el jersey y un desbloqueo
            // biometrico por peticion haria el puesto inviable. La proteccion
            // real es la corta duracion del token.
            .build()

        EncryptedSharedPreferences.create(
            contexto.applicationContext,
            NOMBRE_ARCHIVO,
            claveMaestra,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private val _sesion = MutableStateFlow(leerDelDisco())

    /** Sesion vigente. null cuando no hay ninguna o cuando caduco. */
    val sesion: StateFlow<SesionOperario?> = _sesion.asStateFlow()

    fun guardar(sesion: SesionOperario) {
        preferencias.edit()
            .putString(CLAVE_TOKEN, sesion.token)
            .putLong(CLAVE_EXPIRA_EN, sesion.expiraEnMs)
            .putString(CLAVE_ID_USUARIO, sesion.idUsuario)
            .putString(CLAVE_NOMBRE, sesion.nombreMostrable)
            .putBoolean(CLAVE_DISPOSITIVO_AUTORIZADO, sesion.dispositivoAutorizado)
            .putString(CLAVE_ETIQUETA_DISPOSITIVO, sesion.etiquetaDispositivo)
            .apply()
        _sesion.value = sesion
        // Se registra el hecho, jamas el token.
        Registro.informacion(ETIQUETA, "Sesión guardada para el operario ${sesion.nombreMostrable}.")
    }

    fun limpiar() {
        preferencias.edit().clear().apply()
        _sesion.value = null
        Registro.informacion(ETIQUETA, "Sesión cerrada y credenciales borradas del dispositivo.")
    }

    /**
     * Token para el interceptor de autorizacion.
     *
     * Devuelve null si la sesion caduco, y ademas la borra: de este modo una
     * peticion nunca sale con una credencial vencida y el estado observable de
     * la app pasa a "sin sesion" sin necesitar una respuesta 401.
     */
    fun tokenVigente(): String? {
        val actual = _sesion.value ?: return null
        if (actual.estaCaducada()) {
            limpiar()
            return null
        }
        return actual.token
    }

    private fun leerDelDisco(): SesionOperario? {
        val token = preferencias.getString(CLAVE_TOKEN, null) ?: return null
        val sesion = SesionOperario(
            token = token,
            expiraEnMs = preferencias.getLong(CLAVE_EXPIRA_EN, 0L),
            idUsuario = preferencias.getString(CLAVE_ID_USUARIO, "") ?: "",
            nombreMostrable = preferencias.getString(CLAVE_NOMBRE, "") ?: "",
            dispositivoAutorizado = preferencias.getBoolean(CLAVE_DISPOSITIVO_AUTORIZADO, false),
            etiquetaDispositivo = preferencias.getString(CLAVE_ETIQUETA_DISPOSITIVO, null),
        )
        if (sesion.estaCaducada()) {
            preferencias.edit().clear().apply()
            return null
        }
        return sesion
    }

    private companion object {
        const val ETIQUETA = "Sesion"
        const val NOMBRE_ARCHIVO = "sesion_operario_cifrada"
        const val ALIAS_CLAVE_MAESTRA = "marathon_nfc_studio_clave_maestra"
        const val CLAVE_TOKEN = "token"
        const val CLAVE_EXPIRA_EN = "expira_en"
        const val CLAVE_ID_USUARIO = "id_usuario"
        const val CLAVE_NOMBRE = "nombre"
        const val CLAVE_DISPOSITIVO_AUTORIZADO = "dispositivo_autorizado"
        const val CLAVE_ETIQUETA_DISPOSITIVO = "etiqueta_dispositivo"
    }
}

/**
 * Sesion del operario.
 *
 * El token es `private` a proposito: fuera de este archivo se accede por
 * [AlmacenSesion.tokenVigente], que comprueba la caducidad. Asi ninguna pantalla
 * puede leerlo para mostrarlo o registrarlo.
 */
data class SesionOperario(
    internal val token: String,
    val expiraEnMs: Long,
    val idUsuario: String,
    val nombreMostrable: String,
    /**
     * Si el SERVIDOR confirmo que este telefono esta habilitado para programar.
     *
     * Se falla cerrado: cuando el servidor no lo informa, la app asume que NO lo
     * esta y bloquea las operaciones de escritura. Es una comprobacion de
     * usabilidad, no de seguridad: la autoridad real es el servidor, que rechaza
     * la reserva con 403 si el dispositivo no esta dado de alta.
     */
    val dispositivoAutorizado: Boolean,
    val etiquetaDispositivo: String?,
) {
    fun estaCaducada(ahoraMs: Long = System.currentTimeMillis()): Boolean = ahoraMs >= expiraEnMs

    fun minutosRestantes(ahoraMs: Long = System.currentTimeMillis()): Long =
        ((expiraEnMs - ahoraMs).coerceAtLeast(0L)) / 60_000L
}
