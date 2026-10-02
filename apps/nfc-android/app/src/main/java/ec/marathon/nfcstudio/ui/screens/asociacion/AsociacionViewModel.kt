package ec.marathon.nfcstudio.ui.screens.asociacion

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.EstadoFlujoUnidad
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import ec.marathon.nfcstudio.domain.model.UnidadVinculada
import ec.marathon.nfcstudio.domain.usecase.VincularConJersey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel de la asociación emblema - jersey.
 *
 * Es el paso en el que el chip deja de ser "un chip grabado" y pasa a ser "este
 * jersey". A partir de aquí el sistema puede responder al aficionado.
 *
 * Sobre la captura de códigos: el campo de texto acepta tanto tecleo manual como
 * la entrada de un lector de códigos de barras externo (los lectores de anillo y
 * las fundas-pistola de planta se presentan al sistema como teclado, por lo que
 * "escanear" es simplemente que el campo tenga el foco). La integración con la
 * cámara del teléfono queda PENDIENTE: requiere el permiso de cámara, una
 * biblioteca de decodificación y pruebas de enfoque sobre etiqueta impresa en
 * tela, que no se pueden hacer sin dispositivo.
 */
class AsociacionViewModel(
    private val flujoUnidad: EstadoFlujoUnidad,
    private val vincularConJersey: VincularConJersey,
) : ViewModel() {

    sealed interface EstadoUi {

        /** Falta el trabajo de programación: no se llegó aquí por el flujo. */
        data object SinTrabajo : EstadoUi

        data class Capturando(
            val orden: OrdenProduccion,
            val codigoEmblema: String = "",
            val codigoJersey: String = "",
            val error: ErrorApp? = null,
            val simulacion: Boolean = false,
        ) : EstadoUi {
            /**
             * Longitudes mínimas defensivas. La validación real la hace el
             * servidor: comprobar aquí el formato exacto obligaría a duplicar
             * reglas de negocio en el cliente y a actualizar la APK cada vez que
             * cambie un formato de etiqueta.
             */
            val puedeVincular: Boolean
                get() = codigoEmblema.trim().length >= 4 && codigoJersey.trim().length >= 6
        }

        data object Enviando : EstadoUi

        data class Vinculada(
            val unidad: UnidadVinculada,
            val listoParaPrensa: Boolean,
            val simulacion: Boolean,
        ) : EstadoUi

        data class Fallo(
            val orden: OrdenProduccion,
            val error: ErrorApp,
            val codigoEmblema: String,
            val codigoJersey: String,
        ) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.SinTrabajo)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        val datos = flujoUnidad.estado.value
        _estado.value = if (datos.orden == null || !datos.listaParaVincular) {
            EstadoUi.SinTrabajo
        } else {
            EstadoUi.Capturando(orden = datos.orden, simulacion = datos.simulado)
        }
    }

    fun cambiarCodigoEmblema(valor: String) {
        val actual = _estado.value
        if (actual is EstadoUi.Capturando) {
            _estado.value = actual.copy(codigoEmblema = valor, error = null)
        }
    }

    fun cambiarCodigoJersey(valor: String) {
        val actual = _estado.value
        if (actual is EstadoUi.Capturando) {
            _estado.value = actual.copy(codigoJersey = valor, error = null)
        }
    }

    fun vincular() {
        val actual = _estado.value
        if (actual !is EstadoUi.Capturando || !actual.puedeVincular) return

        val datos = flujoUnidad.estado.value
        val trabajo = datos.trabajo ?: return

        _estado.value = EstadoUi.Enviando
        flujoUnidad.registrarCodigos(
            codigoEmblema = actual.codigoEmblema.trim(),
            codigoBarrasJersey = actual.codigoJersey.trim(),
        )

        viewModelScope.launch {
            val resultado = vincularConJersey.ejecutar(
                codigoOrden = actual.orden.codigo,
                idTrabajo = trabajo.idTrabajo,
                codigoSku = actual.orden.codigoSku,
                codigoEmblema = actual.codigoEmblema.trim(),
                codigoBarrasJersey = actual.codigoJersey.trim(),
                // MISMA clave en cada reintento de esta unidad.
                clave = datos.claves.vinculacion,
                simulado = datos.simulado,
            )

            _estado.value = when (resultado) {
                is Resultado.Exito -> {
                    flujoUnidad.registrarUnidad(resultado.valor.unidad)
                    EstadoUi.Vinculada(
                        unidad = resultado.valor.unidad,
                        listoParaPrensa = resultado.valor.listoParaPrensaConfirmado,
                        simulacion = datos.simulado,
                    )
                }

                is Resultado.Fallo -> EstadoUi.Fallo(
                    orden = actual.orden,
                    error = resultado.error,
                    codigoEmblema = actual.codigoEmblema,
                    codigoJersey = actual.codigoJersey,
                )
            }
        }
    }

    /** Reintento: conserva los códigos y la clave de idempotencia. */
    fun reintentar() {
        val actual = _estado.value
        if (actual is EstadoUi.Fallo) {
            _estado.value = EstadoUi.Capturando(
                orden = actual.orden,
                codigoEmblema = actual.codigoEmblema,
                codigoJersey = actual.codigoJersey,
                simulacion = flujoUnidad.estado.value.simulado,
            )
        }
    }
}
