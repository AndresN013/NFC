package ec.marathon.nfcstudio.core.atestacion

import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.core.Resultado

/**
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Preparacion para attestation de dispositivo".  #
 * ###########################################################################
 *
 * Que problema resolveria esto: hoy el servidor confia en que la aplicacion que
 * le habla es la APK firmada por Marathon corriendo en un telefono integro. No
 * tiene forma de comprobarlo. Un APK modificado podria reportar "escritura
 * correcta" sin haber tocado un chip, y el inventario cuadraria con jerseys sin
 * programar.
 *
 * Play Integrity API responde a esa pregunta: emite un veredicto FIRMADO POR
 * GOOGLE sobre (a) la integridad del binario, (b) la integridad del dispositivo
 * y (c) la licencia de la cuenta. El veredicto lo verifica el SERVIDOR, nunca
 * la app: un cliente que se autoevalua no prueba nada.
 *
 * PUNTO DE INTEGRACION (fase posterior, no implementado aqui):
 *
 *  1. Dependencia: `com.google.android.play:integrity`.
 *  2. El servidor genera un `nonce` unico por operacion sensible y lo devuelve
 *     en la respuesta de login o de reserva de trabajo.
 *  3. La app llama a `IntegrityManager.requestIntegrityToken(...)` con ese nonce
 *     y obtiene un token opaco.
 *  4. La app envia el token en la cabecera `X-Integrity-Token` de las
 *     operaciones de escritura (reserve / written / verified / link / activate).
 *     El interceptor donde se anadiria ya existe: ver `InterceptorAtestacion`
 *     en `data/api/ClienteHttp.kt`.
 *  5. El servidor lo descifra con la clave de la consola de Google Play,
 *     comprueba el nonce, el `packageName`, el `certificateSha256Digest` y los
 *     veredictos, y RECHAZA la operacion si no cuadran.
 *
 * Por que no se implementa ahora: requiere la aplicacion dada de alta en Google
 * Play Console, la clave de descifrado del veredicto y el endpoint de
 * verificacion en la API. Nada de eso existe todavia. Se deja la interfaz para
 * que el dia que exista no haya que tocar ni la capa de red ni los ViewModels.
 */
interface DeviceAttestationProvider {

    /** `true` cuando el proveedor puede emitir tokens reales. */
    val disponible: Boolean

    /** Nombre mostrable en la pantalla de Configuracion, para que el
     *  supervisor sepa si el telefono esta o no atestiguado. */
    val nombreMostrable: String

    /**
     * Solicita un token de integridad ligado a [nonce].
     *
     * @param nonce valor de un solo uso emitido por el SERVIDOR. Si el nonce lo
     *   generara el telefono, un atacante podria reutilizar un token antiguo.
     */
    suspend fun obtenerToken(nonce: String): Resultado<TokenAtestacion>
}

/**
 * Token opaco. La app NO lo interpreta: lo transporta. Cualquier intento de
 * leer el veredicto en el cliente seria una falsa sensacion de seguridad.
 */
@JvmInline
value class TokenAtestacion(val valor: String)

/**
 * Implementacion nula que se usa hoy.
 *
 * Declara `disponible = false` y no produce token. Las llamadas siguen su curso
 * sin la cabecera de integridad: el servidor decide si eso es aceptable segun
 * su configuracion. No se finge un token valido ni se devuelve una cadena
 * cualquiera, porque eso convertiria una comprobacion ausente en una
 * comprobacion aparentemente superada.
 */
class NoopAttestationProvider : DeviceAttestationProvider {

    override val disponible: Boolean = false

    override val nombreMostrable: String = "Sin atestación (pendiente de Play Integrity)"

    override suspend fun obtenerToken(nonce: String): Resultado<TokenAtestacion> {
        Registro.depuracion(
            ETIQUETA,
            "Atestación no disponible; la operación continúa sin token de integridad.",
        )
        return Resultado.Fallo(
            ec.marathon.nfcstudio.core.ErrorApp.de(
                codigo = ec.marathon.nfcstudio.core.CodigoError.NO_IMPLEMENTADO,
                detalleTecnico = "NoopAttestationProvider: Play Integrity no integrado todavía.",
                reintentable = false,
            ),
        )
    }

    private companion object {
        const val ETIQUETA = "Atestacion"
    }
}
