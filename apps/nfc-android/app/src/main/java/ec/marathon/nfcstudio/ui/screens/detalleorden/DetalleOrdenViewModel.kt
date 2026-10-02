package ec.marathon.nfcstudio.ui.screens.detalleorden

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.EstadoFlujoUnidad
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.RepositorioOrdenes
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel del cuarto paso del flujo: confirmar la orden antes de empezar.
 *
 * Esta pantalla existe por un motivo muy concreto de planta: el operario tiene
 * delante una caja de emblemas y un carro de jerseys, y necesita CONFIRMAR con la
 * vista que el club, la temporada, el modelo y el lote coinciden con lo que va a
 * coser. Un cruce de lotes se detecta aquí o no se detecta.
 */
class DetalleOrdenViewModel(
    private val repositorio: RepositorioOrdenes,
    private val flujoUnidad: EstadoFlujoUnidad,
    private val idOrden: String,
    private val modoSimulacion: () -> Boolean,
) : ViewModel() {

    sealed interface EstadoUi {

        data object Cargando : EstadoUi

        data class Cargada(val orden: OrdenProduccion) : EstadoUi {
            val puedeEmpezar: Boolean get() = orden.admiteTrabajo
        }

        data class Fallo(val error: ErrorApp) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Cargando)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        cargar()
    }

    fun cargar() {
        _estado.value = EstadoUi.Cargando
        viewModelScope.launch {
            _estado.value = when (val resultado = repositorio.obtener(idOrden)) {
                is Resultado.Exito -> EstadoUi.Cargada(resultado.valor)
                is Resultado.Fallo -> EstadoUi.Fallo(resultado.error)
            }
        }
    }

    /**
     * Fija la orden en el estado compartido del flujo y genera las claves de
     * idempotencia de la PRIMERA unidad. A partir de aquí, Programación,
     * Asociación y Control post-termosellado trabajan sobre esa misma unidad.
     */
    fun empezar(): Boolean {
        val actual = _estado.value
        if (actual !is EstadoUi.Cargada || !actual.puedeEmpezar) return false
        flujoUnidad.iniciarUnidad(actual.orden, modoSimulacion())
        return true
    }
}
