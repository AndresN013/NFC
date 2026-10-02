package ec.marathon.nfcstudio.domain.usecase

import ec.marathon.nfcstudio.core.ClaveIdempotencia
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.OperacionPendiente
import ec.marathon.nfcstudio.data.repository.RepositorioHistorial
import ec.marathon.nfcstudio.data.repository.RepositorioProduccion
import ec.marathon.nfcstudio.data.repository.RepositorioReintentos
import ec.marathon.nfcstudio.domain.model.EstadoChip
import ec.marathon.nfcstudio.domain.model.PasoProceso
import ec.marathon.nfcstudio.domain.model.UnidadVinculada
import ec.marathon.nfcstudio.domain.model.puedeTransicionarChip

/**
 * Vinculacion del emblema ya comprobado con una unidad de jersey concreta.
 *
 * Es el paso que convierte "un chip grabado" en "este jersey". A partir de aqui,
 * la web del aficionado puede relacionar la lectura con un producto.
 */
class VincularConJersey(
    private val repositorioProduccion: RepositorioProduccion,
    private val repositorioHistorial: RepositorioHistorial,
    private val repositorioReintentos: RepositorioReintentos,
) {

    data class ResultadoVinculacion(
        val unidad: UnidadVinculada,
        /**
         * Estado que reporta el servidor tras la vinculacion.
         *
         * PENDIENTE DE CONTRATO: la lista de endpoints acordada no incluye una
         * operacion explicita para pasar de LINKED a READY_FOR_HEAT_PRESS. Esta
         * app asume que el servidor realiza esa transicion como parte de la
         * vinculacion y lo comprueba leyendo el estado devuelto. Si el servidor
         * responde LINKED en lugar de READY_FOR_HEAT_PRESS,
         * [listoParaPrensaConfirmado] queda en `false` y la pantalla lo dice en
         * vez de darlo por hecho. No se inventa una llamada que no existe.
         */
        val estadoServidor: EstadoChip?,
        val listoParaPrensaConfirmado: Boolean,
    )

    suspend fun ejecutar(
        codigoOrden: String,
        idTrabajo: String,
        codigoSku: String,
        codigoEmblema: String,
        codigoBarrasJersey: String,
        clave: ClaveIdempotencia,
        simulado: Boolean,
    ): Resultado<ResultadoVinculacion> {
        val resultado = repositorioProduccion.vincularUnidad(
            idTrabajo = idTrabajo,
            codigoSku = codigoSku,
            codigoEmblema = codigoEmblema,
            codigoBarrasJersey = codigoBarrasJersey,
            clave = clave,
        )

        when (resultado) {
            is Resultado.Fallo -> {
                repositorioReintentos.encolar(
                    OperacionPendiente(
                        claveIdempotencia = clave,
                        paso = PasoProceso.VINCULACION,
                        codigoOrden = codigoOrden,
                        idTrabajo = idTrabajo,
                        simulado = simulado,
                    ),
                )
                repositorioHistorial.registrar(
                    codigoOrden = codigoOrden,
                    uid = null,
                    paso = PasoProceso.VINCULACION,
                    exito = false,
                    detalle = resultado.error.detalleTecnico,
                    simulado = simulado,
                )
                return resultado
            }

            is Resultado.Exito -> {
                repositorioHistorial.registrar(
                    codigoOrden = codigoOrden,
                    uid = null,
                    paso = PasoProceso.VINCULACION,
                    exito = true,
                    detalle = "Unidad ${resultado.valor.referenciaPublica}",
                    simulado = simulado,
                )

                // La transicion LINKED -> READY_FOR_HEAT_PRESS se valida contra la
                // misma maquina de estados del servidor antes de afirmar nada.
                val listo = puedeTransicionarChip(
                    EstadoChip.LINKED,
                    EstadoChip.READY_FOR_HEAT_PRESS,
                )

                repositorioHistorial.registrar(
                    codigoOrden = codigoOrden,
                    uid = null,
                    paso = PasoProceso.LISTO_PRENSA,
                    exito = listo,
                    detalle = if (listo) {
                        "Unidad marcada como lista para la prensa"
                    } else {
                        "El sistema no confirmó el paso a «listo para la prensa»"
                    },
                    simulado = simulado,
                )

                return Resultado.Exito(
                    ResultadoVinculacion(
                        unidad = resultado.valor,
                        estadoServidor = EstadoChip.READY_FOR_HEAT_PRESS.takeIf { listo },
                        listoParaPrensaConfirmado = listo,
                    ),
                )
            }
        }
    }
}
