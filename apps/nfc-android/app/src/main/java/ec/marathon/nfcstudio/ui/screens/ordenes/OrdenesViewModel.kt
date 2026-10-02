package ec.marathon.nfcstudio.ui.screens.ordenes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.RepositorioOrdenes
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel del tercer paso del flujo: elegir la orden de producción.
 *
 * La lista se recarga a mano y no en bucle: un sondeo automático en cuarenta
 * teléfonos contra la misma API multiplica la carga sin aportar nada, porque el
 * operario trabaja sobre una orden durante horas.
 */
class OrdenesViewModel(
    private val repositorio: RepositorioOrdenes,
) : ViewModel() {

    sealed interface EstadoUi {

        data object Cargando : EstadoUi

        data class Listas(
            val ordenes: List<OrdenProduccion>,
            val recargando: Boolean = false,
        ) : EstadoUi {
            val trabajables: List<OrdenProduccion> get() = ordenes.filter { it.admiteTrabajo }
            val cerradas: List<OrdenProduccion> get() = ordenes.filterNot { it.admiteTrabajo }
        }

        data class Vacia(val mensaje: String) : EstadoUi

        data class Fallo(val error: ErrorApp) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Cargando)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        cargar()
    }

    fun cargar() {
        val anterior = _estado.value
        if (anterior is EstadoUi.Listas) {
            _estado.value = anterior.copy(recargando = true)
        } else {
            _estado.value = EstadoUi.Cargando
        }

        viewModelScope.launch {
            _estado.value = when (val resultado = repositorio.listar()) {
                is Resultado.Exito -> if (resultado.valor.isEmpty()) {
                    EstadoUi.Vacia(
                        "No hay órdenes asignadas a este puesto ahora mismo. " +
                            "Consulte con el supervisor.",
                    )
                } else {
                    EstadoUi.Listas(resultado.valor)
                }

                is Resultado.Fallo -> EstadoUi.Fallo(resultado.error)
            }
        }
    }
}
