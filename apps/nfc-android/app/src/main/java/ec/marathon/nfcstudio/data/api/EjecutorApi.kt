package ec.marathon.nfcstudio.data.api

import ec.marathon.nfcstudio.core.CodigoError
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.core.Resultado
import kotlinx.coroutines.CancellationException
import retrofit2.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Puente entre Retrofit y [Resultado].
 *
 * Todas las llamadas de los repositorios pasan por aqui, y por tres razones:
 *
 *  1. Traduce el sobre de error `{error:{code,message,retryable}}` a un
 *     [ErrorApp] con mensaje de operario. El texto que envia el servidor se
 *     guarda en el detalle tecnico, NO se muestra: esta redactado para un
 *     desarrollador y puede filtrar informacion util a un atacante.
 *  2. Convierte los fallos de transporte (sin cobertura en la nave, tiempo
 *     agotado) en codigos propios, que son los mas frecuentes en planta.
 *  3. Deja una sola linea de registro, ya redactada, por cada llamada fallida.
 */
object EjecutorApi {

    suspend fun <T> ejecutar(
        descripcion: String,
        bloque: suspend () -> Response<T>,
    ): Resultado<T> = try {
        val respuesta = bloque()
        if (respuesta.isSuccessful) {
            val cuerpo = respuesta.body()
            if (cuerpo == null) {
                Resultado.Fallo(
                    ErrorApp.de(
                        CodigoError.RESPUESTA_ILEGIBLE,
                        "$descripcion: respuesta ${respuesta.code()} sin cuerpo",
                    ),
                )
            } else {
                Resultado.Exito(cuerpo)
            }
        } else {
            Resultado.Fallo(traducirRespuestaDeError(descripcion, respuesta))
        }
    } catch (cancelacion: CancellationException) {
        // Nunca se traga una cancelacion: si el operario abandona la pantalla,
        // la corrutina debe morir, no convertirse en un error visible.
        throw cancelacion
    } catch (error: UnknownHostException) {
        fallo(descripcion, CodigoError.SIN_RED, error)
    } catch (error: SocketTimeoutException) {
        fallo(descripcion, CodigoError.TIEMPO_AGOTADO, error)
    } catch (error: IOException) {
        fallo(descripcion, CodigoError.SIN_RED, error)
    } catch (error: Exception) {
        // Incluye fallos de deserializacion de kotlinx.serialization.
        fallo(descripcion, CodigoError.RESPUESTA_ILEGIBLE, error)
    }

    /**
     * Variante para endpoints que responden 204 sin cuerpo: se ignora el cuerpo
     * y solo importa el codigo de estado.
     */
    suspend fun ejecutarSinCuerpo(
        descripcion: String,
        bloque: suspend () -> Response<*>,
    ): Resultado<Unit> = try {
        val respuesta = bloque()
        if (respuesta.isSuccessful) {
            Resultado.Exito(Unit)
        } else {
            Resultado.Fallo(traducirRespuestaDeError(descripcion, respuesta))
        }
    } catch (cancelacion: CancellationException) {
        throw cancelacion
    } catch (error: IOException) {
        fallo(descripcion, CodigoError.SIN_RED, error)
    } catch (error: Exception) {
        fallo(descripcion, CodigoError.RESPUESTA_ILEGIBLE, error)
    }

    private fun traducirRespuestaDeError(descripcion: String, respuesta: Response<*>): ErrorApp {
        val textoError = runCatching { respuesta.errorBody()?.string() }.getOrNull()
        val sobre = textoError?.let { texto ->
            runCatching { FabricaApi.json.decodeFromString(SobreError.serializer(), texto) }
                .getOrNull()
        }

        val codigo = when {
            sobre != null -> CodigoError.desdeApi(sobre.error.code)
            // Sin sobre interpretable, se infiere del codigo HTTP.
            respuesta.code() == 401 -> CodigoError.NO_AUTORIZADO
            respuesta.code() == 403 -> CodigoError.PROHIBIDO
            respuesta.code() == 404 -> CodigoError.NO_ENCONTRADO
            respuesta.code() == 409 -> CodigoError.CONFLICTO
            respuesta.code() == 429 -> CodigoError.LIMITE_DE_PETICIONES
            respuesta.code() == 501 -> CodigoError.NO_IMPLEMENTADO
            else -> CodigoError.INTERNO
        }

        val error = ErrorApp.de(
            codigo = codigo,
            detalleTecnico = "$descripcion: HTTP ${respuesta.code()} código=${sobre?.error?.code ?: "sin sobre"}",
            reintentable = sobre?.error?.retryable,
        )
        Registro.advertencia(ETIQUETA, error.detalleTecnico)
        return error
    }

    private fun fallo(descripcion: String, codigo: CodigoError, causa: Throwable): Resultado.Fallo {
        val error = ErrorApp.de(codigo, "$descripcion: ${causa.javaClass.simpleName}")
        Registro.advertencia(ETIQUETA, error.detalleTecnico, causa)
        return Resultado.Fallo(error)
    }

    private const val ETIQUETA = "Api"
}
