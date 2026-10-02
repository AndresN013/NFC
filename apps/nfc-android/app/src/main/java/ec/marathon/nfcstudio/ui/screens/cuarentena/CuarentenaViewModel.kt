package ec.marathon.nfcstudio.ui.screens.cuarentena

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.EstadoFlujoUnidad
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.RepositorioHistorial
import ec.marathon.nfcstudio.data.repository.RepositorioProduccion
import ec.marathon.nfcstudio.domain.model.MotivoCuarentena
import ec.marathon.nfcstudio.domain.model.PasoProceso
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel de la cuarentena.
 *
 * La cuarentena es una vía de escape SIEMPRE disponible. Cualquier operario puede
 * apartar una unidad en cualquier punto del proceso, sin pedir permiso y sin
 * justificar más allá de elegir un motivo de la lista. El coste de una unidad
 * apartada por precaución es una unidad; el de una unidad dudosa que sale a la
 * calle es la confianza en el producto.
 *
 * El motivo es de lista cerrada [MotivoCuarentena] más una nota libre opcional. Un
 * campo libre como único dato produce texto que nadie puede agregar ni analizar
 * después ("no funciona", "malo", "raro").
 */
class CuarentenaViewModel(
    private val flujoUnidad: EstadoFlujoUnidad,
    private val repositorioProduccion: RepositorioProduccion,
    private val repositorioHistorial: RepositorioHistorial,
) : ViewModel() {

    sealed interface EstadoUi {

        data class Formulario(
            val referenciaPublica: String?,
            val motivo: MotivoCuarentena? = null,
            val nota: String = "",
            val error: ErrorApp? = null,
            val simulacion: Boolean = false,
        ) : EstadoUi {
            /**
             * Si no hay unidad vinculada todavía no existe nada que poner en
             * cuarentena en el servidor: la unidad aún no se creó. En ese caso la
             * pantalla solo registra el hecho en el historial local y le dice al
             * operario qué hacer con el emblema físico.
             */
            val hayUnidadEnServidor: Boolean get() = referenciaPublica != null
            val puedeEnviar: Boolean get() = motivo != null
        }

        data object Enviando : EstadoUi

        data class Registrada(
            val soloLocal: Boolean,
            val motivo: MotivoCuarentena,
        ) : EstadoUi

        data class Fallo(
            val error: ErrorApp,
            val motivo: MotivoCuarentena,
            val referenciaPublica: String?,
        ) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Formulario(null))
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        val datos = flujoUnidad.estado.value
        _estado.value = EstadoUi.Formulario(
            referenciaPublica = datos.unidad?.referenciaPublica,
            simulacion = datos.simulado,
        )
    }

    fun elegirMotivo(motivo: MotivoCuarentena) {
        val actual = _estado.value
        if (actual is EstadoUi.Formulario) {
            _estado.value = actual.copy(motivo = motivo, error = null)
        }
    }

    fun cambiarNota(valor: String) {
        val actual = _estado.value
        if (actual is EstadoUi.Formulario) {
            _estado.value = actual.copy(nota = valor)
        }
    }

    fun enviar() {
        val actual = _estado.value
        if (actual !is EstadoUi.Formulario) return
        val motivo = actual.motivo ?: return

        val datos = flujoUnidad.estado.value
        val idUnidad = datos.unidad?.idUnidad

        _estado.value = EstadoUi.Enviando

        viewModelScope.launch {
            // Siempre se deja constancia local, incluso si el envío falla.
            repositorioHistorial.registrar(
                codigoOrden = datos.orden?.codigo ?: "",
                uid = datos.deteccion?.uid,
                paso = PasoProceso.CUARENTENA,
                exito = true,
                detalle = motivo.etiqueta,
                simulado = datos.simulado,
            )

            if (idUnidad == null) {
                // No hay unidad creada en el servidor: nada que marcar allí.
                _estado.value = EstadoUi.Registrada(soloLocal = true, motivo = motivo)
                return@launch
            }

            val resultado = repositorioProduccion.ponerEnCuarentena(
                idUnidad = idUnidad,
                motivo = motivo,
                detalleLibre = actual.nota.ifBlank { null },
            )

            _estado.value = when (resultado) {
                is Resultado.Exito -> EstadoUi.Registrada(soloLocal = false, motivo = motivo)
                is Resultado.Fallo -> EstadoUi.Fallo(
                    error = resultado.error,
                    motivo = motivo,
                    referenciaPublica = actual.referenciaPublica,
                )
            }
        }
    }

    fun reintentar() {
        val actual = _estado.value
        if (actual is EstadoUi.Fallo) {
            _estado.value = EstadoUi.Formulario(
                referenciaPublica = actual.referenciaPublica,
                motivo = actual.motivo,
                simulacion = flujoUnidad.estado.value.simulado,
            )
        }
    }

    /** Cierra la unidad y prepara la siguiente con claves nuevas. */
    fun siguienteUnidad() {
        flujoUnidad.siguienteUnidad()
    }
}
