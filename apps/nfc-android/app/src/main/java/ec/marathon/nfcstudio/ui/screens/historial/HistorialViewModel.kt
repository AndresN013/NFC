package ec.marathon.nfcstudio.ui.screens.historial

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.data.repository.RepositorioHistorial
import ec.marathon.nfcstudio.domain.model.EventoHistorial
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel del historial del turno.
 *
 * Los datos salen del historial LOCAL del teléfono (ver RepositorioHistorial),
 * que es una copia de conveniencia para poder consultarlo sin red. La auditoría
 * con valor legal es la del servidor.
 */
class HistorialViewModel(
    private val repositorio: RepositorioHistorial,
) : ViewModel() {

    sealed interface EstadoUi {

        data object Cargando : EstadoUi

        data class ConEventos(
            val eventos: List<EventoHistorial>,
        ) : EstadoUi {
            val total: Int get() = eventos.size
            val correctos: Int get() = eventos.count { it.exito }
            val fallidos: Int get() = eventos.count { !it.exito }
            val simulados: Int get() = eventos.count { it.simulado }
        }

        data object Vacio : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Cargando)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        viewModelScope.launch {
            repositorio.eventos.collect { lista ->
                _estado.value = if (lista.isEmpty()) {
                    EstadoUi.Vacio
                } else {
                    EstadoUi.ConEventos(lista)
                }
            }
        }
    }

    fun limpiar() {
        viewModelScope.launch { repositorio.limpiar() }
    }
}
