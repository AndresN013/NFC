package ec.marathon.nfcstudio.data.repository

import ec.marathon.nfcstudio.core.CodigoError
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.core.mapear
import ec.marathon.nfcstudio.data.api.ApiProduccion
import ec.marathon.nfcstudio.data.api.EjecutorApi
import ec.marathon.nfcstudio.data.api.SolicitudLogin
import ec.marathon.nfcstudio.data.session.AlmacenSesion
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.data.session.SesionOperario
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/**
 * Autenticacion del operario.
 *
 * La contrasena entra por parametro, viaja en el cuerpo de una sola peticion y
 * se descarta. No se guarda, no se cachea y no se reintenta automaticamente: si
 * el login falla por red, el operario vuelve a escribirla. Guardarla para
 * "reintentar comodo" seria guardar una credencial de planta en un telefono
 * compartido.
 */
class RepositorioAutenticacion(
    private val api: ApiProduccion,
    private val almacenSesion: AlmacenSesion,
    private val preferencias: PreferenciasApp,
) {

    val sesion: StateFlow<SesionOperario?> = almacenSesion.sesion

    suspend fun iniciarSesion(correo: String, contrasena: String): Resultado<SesionOperario> {
        val idDispositivo = preferencias.asegurarIdDispositivo()

        val resultado = EjecutorApi.ejecutar("login") {
            api.login(
                SolicitudLogin(
                    email = correo.trim(),
                    password = contrasena,
                    deviceId = idDispositivo,
                ),
            )
        }

        return resultado.mapear { respuesta ->
            val sesion = SesionOperario(
                token = respuesta.token,
                expiraEnMs = interpretarInstante(respuesta.expiresAt),
                idUsuario = respuesta.user.id,
                nombreMostrable = respuesta.user.displayName,
                // Fallar cerrado: si el servidor no lo dice, se asume que NO.
                dispositivoAutorizado = respuesta.user.deviceAuthorized ?: false,
                etiquetaDispositivo = respuesta.user.deviceLabel,
            )
            almacenSesion.guardar(sesion)
            // Se recuerda el correo para no obligar a teclearlo con guantes.
            // La contrasena NO se recuerda.
            preferencias.guardarUltimoCorreo(correo)
            sesion
        }
    }

    fun cerrarSesion() = almacenSesion.limpiar()

    /**
     * Comprueba que hay sesion util AHORA. La usan los ViewModels antes de
     * cualquier operacion de escritura para no mandar al operario a apoyar un
     * emblema con una sesion que va a rebotar.
     */
    fun exigirSesionVigente(): Resultado<SesionOperario> {
        val actual = almacenSesion.sesion.value
        return when {
            actual == null -> Resultado.Fallo(
                ErrorApp.de(CodigoError.SESION_EXPIRADA, "No hay sesión almacenada"),
            )
            actual.estaCaducada() -> {
                almacenSesion.limpiar()
                Resultado.Fallo(
                    ErrorApp.de(CodigoError.SESION_EXPIRADA, "La sesión caducó"),
                )
            }
            else -> Resultado.Exito(actual)
        }
    }

    /**
     * Interpreta la fecha de caducidad ISO-8601 que envia el servidor.
     *
     * Si no se puede interpretar se toma una ventana MUY corta (cinco minutos)
     * en lugar de una larga: ante la duda, la sesion dura menos. Lo contrario
     * convertiria un error de formato en un token de vida indefinida.
     */
    private fun interpretarInstante(texto: String): Long = try {
        Instant.parse(texto).toEpochMilli()
    } catch (error: DateTimeParseException) {
        try {
            OffsetDateTime.parse(texto).toInstant().toEpochMilli()
        } catch (segundoError: DateTimeParseException) {
            System.currentTimeMillis() + MARGEN_SEGURO_MS
        }
    }

    private companion object {
        const val MARGEN_SEGURO_MS = 5 * 60 * 1000L
    }
}
