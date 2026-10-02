package ec.marathon.nfcstudio.domain.usecase

import ec.marathon.nfcstudio.core.ClavesDeUnidad
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.OperacionPendiente
import ec.marathon.nfcstudio.data.repository.RepositorioHistorial
import ec.marathon.nfcstudio.data.repository.RepositorioProduccion
import ec.marathon.nfcstudio.data.repository.RepositorioReintentos
import ec.marathon.nfcstudio.domain.model.EstadoChip
import ec.marathon.nfcstudio.domain.model.MedicionTermosellado
import ec.marathon.nfcstudio.domain.model.MotivoCuarentena
import ec.marathon.nfcstudio.domain.model.PasoProceso
import ec.marathon.nfcstudio.nfc.NfcPersonalizationProvider
import ec.marathon.nfcstudio.nfc.PostPressResult
import ec.marathon.nfcstudio.nfc.TagDetection

/**
 * Prueba final tras el termosellado.
 *
 * Por que existe este paso: la prensa aplica calor y presion sobre el emblema.
 * Un chip puede sobrevivir a la grabacion y morir en la prensa, o quedar legible
 * pero con la antena danada de forma que solo responde a dos centimetros. Si no
 * se comprueba DESPUES del calor, el defecto lo descubre el aficionado.
 *
 * Resultado: la unidad se ACTIVA o pasa a CUARENTENA. No hay tercera opcion, y
 * en particular no hay "continuar de todas formas": eso convertiria el control
 * en un adorno.
 */
class ControlPostTermosellado(
    private val repositorioProduccion: RepositorioProduccion,
    private val repositorioHistorial: RepositorioHistorial,
    private val repositorioReintentos: RepositorioReintentos,
) {

    data class Desenlace(
        val prueba: PostPressResult,
        val aprobado: Boolean,
        val estadoFinal: EstadoChip?,
        val mensajeOperario: String,
    )

    suspend fun ejecutar(
        proveedor: NfcPersonalizationProvider,
        deteccion: TagDetection,
        uriEsperada: String,
        codigoOrden: String,
        idUnidad: String,
        medicion: MedicionTermosellado,
        claves: ClavesDeUnidad,
    ): Resultado<Desenlace> {
        val simulado = proveedor.capabilities.isSimulation

        val prueba = proveedor.runPostPressCheck(deteccion, uriEsperada)
        val aprobado = prueba.readable && prueba.contentIntact

        val aviso = repositorioProduccion.reportarPostTermosellado(
            idUnidad = idUnidad,
            aprobado = aprobado,
            legible = prueba.readable,
            contenidoIntacto = prueba.contentIntact,
            medicion = medicion,
            simulado = simulado,
            clave = claves.postTermosellado,
        )

        if (aviso is Resultado.Fallo) {
            repositorioReintentos.encolar(
                OperacionPendiente(
                    claveIdempotencia = claves.postTermosellado,
                    paso = PasoProceso.POST_TERMOSELLADO,
                    codigoOrden = codigoOrden,
                    idUnidad = idUnidad,
                    simulado = simulado,
                ),
            )
            return aviso
        }

        repositorioHistorial.registrar(
            codigoOrden = codigoOrden,
            uid = deteccion.uid,
            paso = PasoProceso.POST_TERMOSELLADO,
            exito = aprobado,
            detalle = prueba.detail,
            simulado = simulado,
        )

        // --- Desenlace: activar o cuarentena --------------------------------
        return if (aprobado) {
            val activacion = repositorioProduccion.activarUnidad(idUnidad, claves.activacion)
            when (activacion) {
                is Resultado.Fallo -> {
                    repositorioReintentos.encolar(
                        OperacionPendiente(
                            claveIdempotencia = claves.activacion,
                            paso = PasoProceso.ACTIVACION,
                            codigoOrden = codigoOrden,
                            idUnidad = idUnidad,
                            simulado = simulado,
                        ),
                    )
                    activacion
                }

                is Resultado.Exito -> {
                    repositorioHistorial.registrar(
                        codigoOrden = codigoOrden,
                        uid = deteccion.uid,
                        paso = PasoProceso.ACTIVACION,
                        exito = true,
                        detalle = "Unidad activada",
                        simulado = simulado,
                    )
                    Resultado.Exito(
                        Desenlace(
                            prueba = prueba,
                            aprobado = true,
                            estadoFinal = activacion.valor ?: EstadoChip.ACTIVATED,
                            mensajeOperario = if (simulado) {
                                "SIMULACIÓN: la unidad se activaría aquí. No cuenta como producción."
                            } else {
                                "Unidad aprobada y activada. Puede pasar a la siguiente."
                            },
                        ),
                    )
                }
            }
        } else {
            val motivo = if (!prueba.readable) {
                MotivoCuarentena.CHIP_NO_RESPONDE
            } else {
                MotivoCuarentena.FALLO_TRAS_PRENSA
            }
            val cuarentena = repositorioProduccion.ponerEnCuarentena(
                idUnidad = idUnidad,
                motivo = motivo,
                detalleLibre = prueba.detail,
            )
            repositorioHistorial.registrar(
                codigoOrden = codigoOrden,
                uid = deteccion.uid,
                paso = PasoProceso.CUARENTENA,
                exito = cuarentena is Resultado.Exito,
                detalle = motivo.etiqueta,
                simulado = simulado,
            )
            when (cuarentena) {
                is Resultado.Fallo -> cuarentena
                is Resultado.Exito -> Resultado.Exito(
                    Desenlace(
                        prueba = prueba,
                        aprobado = false,
                        estadoFinal = cuarentena.valor ?: EstadoChip.QUARANTINED,
                        mensajeOperario = "La unidad no pasó la prueba. Colóquela en la caja " +
                            "roja de cuarentena y anote el número de orden.",
                    ),
                )
            }
        }
    }
}
