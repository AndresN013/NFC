package ec.marathon.nfcstudio

import android.content.Context
import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.core.atestacion.DeviceAttestationProvider
import ec.marathon.nfcstudio.core.atestacion.NoopAttestationProvider
import ec.marathon.nfcstudio.data.api.ApiProduccion
import ec.marathon.nfcstudio.data.api.FabricaApi
import ec.marathon.nfcstudio.data.repository.RepositorioAutenticacion
import ec.marathon.nfcstudio.data.repository.RepositorioHistorial
import ec.marathon.nfcstudio.data.repository.RepositorioOrdenes
import ec.marathon.nfcstudio.data.repository.RepositorioProduccion
import ec.marathon.nfcstudio.data.repository.RepositorioReintentos
import ec.marathon.nfcstudio.data.session.AlmacenSesion
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.domain.usecase.ControlPostTermosellado
import ec.marathon.nfcstudio.domain.usecase.ProgramarChip
import ec.marathon.nfcstudio.domain.usecase.VerificarChip
import ec.marathon.nfcstudio.domain.usecase.VincularConJersey
import ec.marathon.nfcstudio.nfc.LectorNfcAndroid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Contenedor de dependencias.
 *
 * DECISION DE ARQUITECTURA: inyeccion MANUAL, sin Hilt.
 *
 * Motivo: el grafo de esta aplicacion tiene una docena de nodos, todos de ambito
 * de aplicacion, y ninguna necesidad de ambitos anidados ni de reemplazos en
 * tiempo de compilacion. Hilt anadiria un procesador de anotaciones, una capa de
 * generacion de codigo y una superficie de fallo que en este entorno (sin SDK,
 * sin poder compilar) NO se puede verificar. Un contenedor explicito de 80 lineas
 * es leible de arriba abajo y no depende de nada que no se pueda revisar a ojo.
 *
 * Si el proyecto creciera a varios modulos de features, Hilt seria la eleccion
 * correcta y este archivo es el unico que habria que sustituir.
 */
class ContenedorApp(contexto: Context) {

    private val contextoApp = contexto.applicationContext

    /** Ambito de la aplicacion para tareas que sobreviven a las pantallas. */
    private val ambito = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val preferencias = PreferenciasApp(contextoApp)
    val almacenSesion = AlmacenSesion(contextoApp)

    /**
     * Copias observables de las preferencias que la capa de red necesita LEER DE
     * FORMA SINCRONA dentro de un interceptor. Un interceptor no puede suspender.
     */
    private val _urlBase = MutableStateFlow(BuildConfig.URL_API_POR_DEFECTO)
    val urlBase: StateFlow<String> = _urlBase.asStateFlow()

    private val _modoSimulacion = MutableStateFlow(false)
    val modoSimulacion: StateFlow<Boolean> = _modoSimulacion.asStateFlow()

    private val _idDispositivo = MutableStateFlow("")
    val idDispositivo: StateFlow<String> = _idDispositivo.asStateFlow()

    /**
     * Atestacion de dispositivo. Hoy la implementacion nula.
     * Cambiar esta linea por el proveedor de Play Integrity es todo lo que hara
     * falta cuando exista (ver DeviceAttestationProvider).
     */
    val proveedorAtestacion: DeviceAttestationProvider = NoopAttestationProvider()

    val lectorNfc = LectorNfcAndroid(contextoApp)

    private val clienteHttp = FabricaApi.crearClienteOkHttp(
        // El token se lee del almacen CIFRADO en cada peticion, no se cachea aqui.
        proveedorToken = { almacenSesion.tokenVigente() },
        proveedorAtestacion = proveedorAtestacion,
        idDispositivo = { _idDispositivo.value },
        proveedorUrlBase = { _urlBase.value },
    )

    val api: ApiProduccion = FabricaApi.crearApi(clienteHttp)

    val repositorioAutenticacion = RepositorioAutenticacion(api, almacenSesion, preferencias)
    val repositorioOrdenes = RepositorioOrdenes(api)
    val repositorioProduccion = RepositorioProduccion(api)
    val repositorioHistorial = RepositorioHistorial(preferencias)
    val repositorioReintentos = RepositorioReintentos(preferencias)

    val programarChip = ProgramarChip(
        repositorioProduccion = repositorioProduccion,
        repositorioHistorial = repositorioHistorial,
        repositorioReintentos = repositorioReintentos,
    )
    val vincularConJersey = VincularConJersey(
        repositorioProduccion = repositorioProduccion,
        repositorioHistorial = repositorioHistorial,
        repositorioReintentos = repositorioReintentos,
    )
    val controlPostTermosellado = ControlPostTermosellado(
        repositorioProduccion = repositorioProduccion,
        repositorioHistorial = repositorioHistorial,
        repositorioReintentos = repositorioReintentos,
    )
    val verificarChip = VerificarChip()

    /**
     * Estado compartido del flujo entre pantallas.
     *
     * Programación -> Asociación -> Control post-termosellado son tres pantallas
     * de UNA MISMA unidad fisica. El estado no puede vivir en un ViewModel de
     * pantalla porque se destruiria al navegar, ni pasarse por argumentos de
     * navegacion porque incluiria la URI con el token del chip en el
     * back stack, donde queda registrada.
     */
    val flujoUnidad = EstadoFlujoUnidad()

    init {
        ambito.launch {
            _idDispositivo.value = preferencias.asegurarIdDispositivo()
        }
        ambito.launch {
            preferencias.urlBase.collect { valor ->
                if (valor.isNotBlank()) _urlBase.value = valor
            }
        }
        ambito.launch {
            preferencias.modoSimulacion.collect { valor ->
                _modoSimulacion.value = valor
                if (valor) {
                    Registro.advertencia(
                        "Contenedor",
                        "MODO SIMULACIÓN ACTIVO: ninguna operación cuenta como producción real.",
                    )
                }
            }
        }
    }
}
