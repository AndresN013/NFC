package ec.marathon.nfcstudio.ui.screens.configuracion

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.BuildConfig
import ec.marathon.nfcstudio.core.atestacion.DeviceAttestationProvider
import ec.marathon.nfcstudio.data.repository.RepositorioAutenticacion
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.nfc.EstadoNfcTelefono
import ec.marathon.nfcstudio.nfc.LectorNfcAndroid
import ec.marathon.nfcstudio.nfc.Ntag424DnaProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * ViewModel de configuración.
 *
 * ###########################################################################
 * # LO QUE NO HAY EN ESTA PANTALLA, Y ES DELIBERADO                         #
 * ###########################################################################
 *
 * NO hay ningún campo para introducir claves, ni para pegarlas, ni para
 * importarlas de un archivo. Ni aquí ni en ninguna otra pantalla de la
 * aplicación. El material criptográfico se referencia por `ReferenciaClave`
 * opaca y las operaciones que lo usan se ejecutan en el servicio que lo
 * custodia.
 *
 * Por qué importa: un campo de "clave maestra" en una app de planta significa que
 * la clave está escrita en un papel en algún cajón, que pasa por WhatsApp cuando
 * hay que configurar un teléfono nuevo y que rotarla obliga a visitar cuarenta
 * dispositivos. La ausencia de ese campo no es una limitación; es la medida de
 * seguridad.
 *
 * La URL del servidor SÍ es editable, pero solo en compilaciones de depuración
 * (ver [EstadoUi.urlEditable]). En una APK de release apuntar el teléfono a otro
 * servidor sería una forma trivial de exfiltrar la producción.
 */
class ConfiguracionViewModel(
    private val preferencias: PreferenciasApp,
    private val repositorioAutenticacion: RepositorioAutenticacion,
    private val lector: LectorNfcAndroid,
    private val proveedorAtestacion: DeviceAttestationProvider,
) : ViewModel() {

    sealed interface EstadoUi {

        data object Cargando : EstadoUi

        data class Cargada(
            val urlBase: String,
            val urlEnEdicion: String,
            val modoSimulacion: Boolean,
            val estadoNfc: EstadoNfcTelefono,
            val nombreOperario: String,
            val minutosDeSesion: Long,
            val nombreAtestacion: String,
            val atestacionDisponible: Boolean,
            val versionApp: String,
            val pendientesNtag424: List<Ntag424DnaProvider.TareaPendiente>,
        ) : EstadoUi {
            /** Solo en debug: en release la URL queda fija. */
            val urlEditable: Boolean get() = BuildConfig.DEBUG
            val urlCambiada: Boolean get() = urlEnEdicion.trim() != urlBase
        }
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Cargando)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        viewModelScope.launch {
            combine(
                preferencias.urlBase,
                preferencias.modoSimulacion,
                lector.estado,
            ) { url, simulacion, estadoNfc ->
                Triple(url, simulacion, estadoNfc)
            }.collect { (url, simulacion, estadoNfc) ->
                val anterior = _estado.value as? EstadoUi.Cargada
                val sesion = repositorioAutenticacion.sesion.value
                _estado.value = EstadoUi.Cargada(
                    urlBase = url,
                    urlEnEdicion = anterior?.urlEnEdicion?.takeIf { anterior.urlCambiada } ?: url,
                    modoSimulacion = simulacion,
                    estadoNfc = estadoNfc,
                    nombreOperario = sesion?.nombreMostrable ?: "Sin sesión",
                    minutosDeSesion = sesion?.minutosRestantes() ?: 0L,
                    nombreAtestacion = proveedorAtestacion.nombreMostrable,
                    atestacionDisponible = proveedorAtestacion.disponible,
                    versionApp = BuildConfig.VERSION_NAME,
                    pendientesNtag424 = Ntag424DnaProvider.TRABAJO_PENDIENTE,
                )
            }
        }
    }

    fun cambiarUrlEnEdicion(valor: String) {
        val actual = _estado.value
        if (actual is EstadoUi.Cargada) {
            _estado.value = actual.copy(urlEnEdicion = valor)
        }
    }

    fun guardarUrl() {
        val actual = _estado.value
        if (actual !is EstadoUi.Cargada || !actual.urlEditable) return
        viewModelScope.launch {
            preferencias.guardarUrlBase(actual.urlEnEdicion)
            // Cambiar de servidor invalida la sesión: el token de un servidor no
            // vale en otro, y dejarlo puesto produciría errores incomprensibles.
            repositorioAutenticacion.cerrarSesion()
        }
    }

    fun cambiarModoSimulacion(activo: Boolean) {
        viewModelScope.launch { preferencias.guardarModoSimulacion(activo) }
    }

    fun cerrarSesion() = repositorioAutenticacion.cerrarSesion()
}
