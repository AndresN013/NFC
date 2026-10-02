package ec.marathon.nfcstudio.ui.screens.errores

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.core.CodigoError
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.core.mapear
import ec.marathon.nfcstudio.data.repository.OperacionPendiente
import ec.marathon.nfcstudio.data.repository.RepositorioProduccion
import ec.marathon.nfcstudio.data.repository.RepositorioReintentos
import ec.marathon.nfcstudio.domain.model.MedicionTermosellado
import ec.marathon.nfcstudio.domain.model.PasoProceso
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel de errores y reintentos.
 *
 * ###########################################################################
 * # Aquí se materializa el requisito de idempotencia                        #
 * ###########################################################################
 *
 * Cada operación pendiente guarda LA CLAVE DE IDEMPOTENCIA DE SU PRIMER
 * INTENTO. Al reintentar se vuelve a enviar esa misma clave, de modo que:
 *
 *  - si la operación original NUNCA llegó al servidor, se ejecuta ahora;
 *  - si SÍ llegó y solo se perdió la respuesta, el servidor reconoce la clave y
 *    devuelve el resultado de entonces, sin repetir el efecto.
 *
 * Es la diferencia entre "reintentar" y "hacerlo otra vez". Lo segundo, en una
 * operación de reserva de chip, consumiría inventario por duplicado.
 */
class ErroresViewModel(
    private val repositorioReintentos: RepositorioReintentos,
    private val repositorioProduccion: RepositorioProduccion,
) : ViewModel() {

    sealed interface EstadoUi {

        data object Cargando : EstadoUi

        data object SinPendientes : EstadoUi

        data class ConPendientes(
            val pendientes: List<OperacionPendiente>,
            val reintentandoId: String? = null,
            val ultimoError: ErrorApp? = null,
            val ultimoExito: String? = null,
        ) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Cargando)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        viewModelScope.launch {
            repositorioReintentos.pendientes.collect { lista ->
                val anterior = _estado.value
                _estado.value = if (lista.isEmpty()) {
                    EstadoUi.SinPendientes
                } else {
                    EstadoUi.ConPendientes(
                        pendientes = lista,
                        ultimoError = (anterior as? EstadoUi.ConPendientes)?.ultimoError,
                        ultimoExito = (anterior as? EstadoUi.ConPendientes)?.ultimoExito,
                    )
                }
            }
        }
    }

    fun reintentar(operacion: OperacionPendiente) {
        val actual = _estado.value
        if (actual is EstadoUi.ConPendientes) {
            _estado.value = actual.copy(reintentandoId = operacion.idOperacion, ultimoError = null)
        }

        viewModelScope.launch {
            val resultado = repositorioReintentos.reintentar(operacion) { pendiente ->
                ejecutar(pendiente)
            }
            val estadoActual = _estado.value
            if (estadoActual is EstadoUi.ConPendientes) {
                _estado.value = when (resultado) {
                    is Resultado.Exito -> estadoActual.copy(
                        reintentandoId = null,
                        ultimoExito = "Enviado: ${operacion.paso.titulo}",
                        ultimoError = null,
                    )

                    is Resultado.Fallo -> estadoActual.copy(
                        reintentandoId = null,
                        ultimoError = resultado.error,
                        ultimoExito = null,
                    )
                }
            }
        }
    }

    fun reintentarTodas() {
        val actual = _estado.value
        if (actual !is EstadoUi.ConPendientes) return
        viewModelScope.launch {
            // En serie, no en paralelo: el servidor procesa estas operaciones
            // sobre la misma unidad y el orden importa (escritura antes de
            // verificación, verificación antes de vinculación).
            for (pendiente in actual.pendientes.sortedBy { it.creadaEnMs }) {
                repositorioReintentos.reintentar(pendiente) { ejecutar(it) }
            }
        }
    }

    fun descartar(operacion: OperacionPendiente) {
        viewModelScope.launch { repositorioReintentos.descartar(operacion.idOperacion) }
    }

    /**
     * Ejecuta la operación pendiente contra el servidor con SU clave original.
     *
     * Solo se reintentan los pasos cuya información está completamente contenida
     * en la operación guardada. Los que dependen de tener el chip delante (una
     * escritura, una relectura) NO se reintentan aquí: lo que se reintenta es el
     * AVISO al servidor de un hecho que ya ocurrió físicamente.
     */
    private suspend fun ejecutar(pendiente: OperacionPendiente): Resultado<Unit> =
        when (pendiente.paso) {
            PasoProceso.ESCRITURA -> {
                val idTrabajo = pendiente.idTrabajo
                if (idTrabajo == null) {
                    faltanDatos()
                } else {
                    repositorioProduccion.reportarEscritura(
                        idTrabajo = idTrabajo,
                        exito = true,
                        hashPayload = pendiente.hashPayload ?: "",
                        codigoError = null,
                        clave = pendiente.claveIdempotencia,
                    ).mapear { }
                }
            }

            PasoProceso.RELECTURA -> {
                val idTrabajo = pendiente.idTrabajo
                if (idTrabajo == null) {
                    faltanDatos()
                } else {
                    repositorioProduccion.reportarVerificacion(
                        idTrabajo = idTrabajo,
                        coincide = pendiente.coincide ?: false,
                        uriReleida = pendiente.uriReleida,
                        clave = pendiente.claveIdempotencia,
                    ).mapear { }
                }
            }

            PasoProceso.POST_TERMOSELLADO -> {
                val idUnidad = pendiente.idUnidad
                if (idUnidad == null) {
                    faltanDatos()
                } else {
                    repositorioProduccion.reportarPostTermosellado(
                        idUnidad = idUnidad,
                        aprobado = pendiente.coincide ?: false,
                        legible = pendiente.coincide ?: false,
                        contenidoIntacto = pendiente.coincide ?: false,
                        // No se inventan los parámetros de prensa que no se
                        // capturaron: se envían nulos.
                        medicion = MedicionTermosellado(null, null, null),
                        simulado = pendiente.simulado,
                        clave = pendiente.claveIdempotencia,
                    ).mapear { }
                }
            }

            PasoProceso.ACTIVACION -> {
                val idUnidad = pendiente.idUnidad
                if (idUnidad == null) {
                    faltanDatos()
                } else {
                    repositorioProduccion.activarUnidad(
                        idUnidad = idUnidad,
                        clave = pendiente.claveIdempotencia,
                    ).mapear { }
                }
            }

            /*
             * VINCULACION no se reintenta desde aquí: requiere el SKU y los dos
             * códigos escaneados, y guardar el código de barras del jersey en la
             * cola sería guardar datos de producto en claro sin necesidad. El
             * operario repite la vinculación desde su pantalla, donde la clave de
             * idempotencia sigue siendo la misma mientras no cambie de unidad.
             */
            else -> Resultado.Fallo(
                ErrorApp.de(
                    CodigoError.NO_IMPLEMENTADO,
                    "El paso ${pendiente.paso.name} se reintenta desde su propia pantalla",
                ),
            )
        }

    private fun faltanDatos(): Resultado<Unit> = Resultado.Fallo(
        ErrorApp.de(
            CodigoError.SOLICITUD_INVALIDA,
            "La operación pendiente no tiene los identificadores necesarios",
        ),
    )
}
