package ec.marathon.nfcstudio.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import ec.marathon.nfcstudio.ContenedorApp
import ec.marathon.nfcstudio.ui.screens.asociacion.AsociacionViewModel
import ec.marathon.nfcstudio.ui.screens.asociacion.PantallaAsociacionConJersey
import ec.marathon.nfcstudio.ui.screens.configuracion.ConfiguracionViewModel
import ec.marathon.nfcstudio.ui.screens.configuracion.PantallaConfiguracion
import ec.marathon.nfcstudio.ui.screens.cuarentena.CuarentenaViewModel
import ec.marathon.nfcstudio.ui.screens.cuarentena.PantallaCuarentena
import ec.marathon.nfcstudio.ui.screens.detalleorden.DetalleOrdenViewModel
import ec.marathon.nfcstudio.ui.screens.detalleorden.PantallaDetalleOrden
import ec.marathon.nfcstudio.ui.screens.errores.ErroresViewModel
import ec.marathon.nfcstudio.ui.screens.errores.PantallaErroresYReintentos
import ec.marathon.nfcstudio.ui.screens.estadonfc.EstadoNfcViewModel
import ec.marathon.nfcstudio.ui.screens.estadonfc.PantallaEstadoNfcTelefono
import ec.marathon.nfcstudio.ui.screens.historial.HistorialViewModel
import ec.marathon.nfcstudio.ui.screens.historial.PantallaHistorialOperario
import ec.marathon.nfcstudio.ui.screens.login.LoginViewModel
import ec.marathon.nfcstudio.ui.screens.login.PantallaLogin
import ec.marathon.nfcstudio.ui.screens.ordenes.OrdenesViewModel
import ec.marathon.nfcstudio.ui.screens.ordenes.PantallaOrdenesDisponibles
import ec.marathon.nfcstudio.ui.screens.postpress.ControlPostTermoselladoViewModel
import ec.marathon.nfcstudio.ui.screens.postpress.PantallaControlPostTermosellado
import ec.marathon.nfcstudio.ui.screens.programacion.PantallaProgramacion
import ec.marathon.nfcstudio.ui.screens.programacion.ProgramacionViewModel
import ec.marathon.nfcstudio.ui.screens.verificacion.PantallaVerificacion
import ec.marathon.nfcstudio.ui.screens.verificacion.VerificacionViewModel

/**
 * Rutas de navegación.
 *
 * REGLA: por los argumentos de navegación viajan SOLO identificadores públicos
 * (el id de una orden). Nunca la URI del chip, nunca el UID, nunca el token. El
 * back stack de Compose se serializa en el `savedInstanceState` del sistema y
 * puede acabar en disco; un token de chip ahí es un token filtrado.
 *
 * Todo lo sensible viaja por `EstadoFlujoUnidad`, que vive en memoria.
 */
object Rutas {
    const val LOGIN = "login"
    const val ESTADO_NFC = "estado_nfc"
    const val ORDENES = "ordenes"
    const val DETALLE_ORDEN = "detalle_orden"
    const val ARG_ID_ORDEN = "idOrden"
    const val DETALLE_ORDEN_CON_ARG = "$DETALLE_ORDEN/{$ARG_ID_ORDEN}"
    const val PROGRAMACION = "programacion"
    const val VERIFICACION = "verificacion"
    const val ASOCIACION = "asociacion"
    const val POST_TERMOSELLADO = "post_termosellado"
    const val HISTORIAL = "historial"
    const val ERRORES = "errores"
    const val CUARENTENA = "cuarentena"
    const val CONFIGURACION = "configuracion"
}

/**
 * Grafo de navegación completo.
 *
 * El orden de las rutas refleja el FLUJO OBLIGATORIO:
 * login -> estado del teléfono -> órdenes -> detalle -> programación ->
 * asociación con el jersey -> control tras la prensa.
 *
 * Las pantallas transversales (verificación, historial, pendientes, cuarentena,
 * configuración) son accesibles desde los puntos donde tienen sentido, pero
 * ninguna permite saltarse un paso del flujo: cada ViewModel comprueba que tiene
 * los datos del paso anterior y muestra un aviso si no es así.
 */
@Composable
fun NavegacionApp(contenedor: ContenedorApp) {
    val navegador: NavHostController = rememberNavController()
    val sesion by contenedor.repositorioAutenticacion.sesion.collectAsStateWithLifecycle()
    val modoSimulacion by contenedor.modoSimulacion.collectAsStateWithLifecycle()

    val rutaInicial = if (sesion == null) Rutas.LOGIN else Rutas.ESTADO_NFC

    NavHost(navController = navegador, startDestination = rutaInicial) {

        // --- 1. Login -------------------------------------------------------
        composable(Rutas.LOGIN) {
            val modelo: LoginViewModel = viewModel(
                factory = fabricaDe {
                    LoginViewModel(
                        repositorio = contenedor.repositorioAutenticacion,
                        preferencias = contenedor.preferencias,
                    )
                },
            )
            PantallaLogin(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alIngresar = {
                    navegador.navigate(Rutas.ESTADO_NFC) {
                        // Se elimina el login del historial: volver atrás desde el
                        // estado del teléfono no debe devolver a un formulario ya
                        // enviado.
                        popUpTo(Rutas.LOGIN) { inclusive = true }
                    }
                },
            )
        }

        // --- 2. Estado NFC del teléfono -------------------------------------
        composable(Rutas.ESTADO_NFC) {
            val modelo: EstadoNfcViewModel = viewModel(
                factory = fabricaDe {
                    EstadoNfcViewModel(
                        lector = contenedor.lectorNfc,
                        preferencias = contenedor.preferencias,
                        sesionActual = { contenedor.almacenSesion.sesion.value },
                    )
                },
            )
            PantallaEstadoNfcTelefono(
                modelo = modelo,
                alContinuar = { navegador.navigate(Rutas.ORDENES) },
                alCerrarSesion = {
                    contenedor.repositorioAutenticacion.cerrarSesion()
                    contenedor.flujoUnidad.limpiar()
                    navegador.navigate(Rutas.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }

        // --- 3. Órdenes disponibles -----------------------------------------
        composable(Rutas.ORDENES) {
            val modelo: OrdenesViewModel = viewModel(
                factory = fabricaDe { OrdenesViewModel(contenedor.repositorioOrdenes) },
            )
            PantallaOrdenesDisponibles(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alElegirOrden = { orden ->
                    navegador.navigate("${Rutas.DETALLE_ORDEN}/${orden.id}")
                },
                alAbrirHistorial = { navegador.navigate(Rutas.HISTORIAL) },
                alAbrirPendientes = { navegador.navigate(Rutas.ERRORES) },
                alAbrirVerificacion = { navegador.navigate(Rutas.VERIFICACION) },
                alAbrirConfiguracion = { navegador.navigate(Rutas.CONFIGURACION) },
            )
        }

        // --- 4. Detalle de la orden -----------------------------------------
        composable(
            route = Rutas.DETALLE_ORDEN_CON_ARG,
            arguments = listOf(navArgument(Rutas.ARG_ID_ORDEN) { type = NavType.StringType }),
        ) { entrada ->
            val idOrden = entrada.arguments?.getString(Rutas.ARG_ID_ORDEN).orEmpty()
            val modelo: DetalleOrdenViewModel = viewModel(
                factory = fabricaDe {
                    DetalleOrdenViewModel(
                        repositorio = contenedor.repositorioOrdenes,
                        flujoUnidad = contenedor.flujoUnidad,
                        idOrden = idOrden,
                        modoSimulacion = { contenedor.modoSimulacion.value },
                    )
                },
            )
            PantallaDetalleOrden(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alEmpezar = { navegador.navigate(Rutas.PROGRAMACION) },
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- 5. Programación ------------------------------------------------
        composable(Rutas.PROGRAMACION) {
            val modelo: ProgramacionViewModel = viewModel(
                factory = fabricaDe {
                    ProgramacionViewModel(
                        lector = contenedor.lectorNfc,
                        flujoUnidad = contenedor.flujoUnidad,
                        programarChip = contenedor.programarChip,
                        modoSimulacion = { contenedor.modoSimulacion.value },
                    )
                },
            )
            PantallaProgramacion(
                modelo = modelo,
                alPasarAVincular = { navegador.navigate(Rutas.ASOCIACION) },
                alAbrirCuarentena = { navegador.navigate(Rutas.CUARENTENA) },
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- 6. Asociación con el jersey ------------------------------------
        composable(Rutas.ASOCIACION) {
            val modelo: AsociacionViewModel = viewModel(
                factory = fabricaDe {
                    AsociacionViewModel(
                        flujoUnidad = contenedor.flujoUnidad,
                        vincularConJersey = contenedor.vincularConJersey,
                    )
                },
            )
            PantallaAsociacionConJersey(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alPasarAPostTermosellado = { navegador.navigate(Rutas.POST_TERMOSELLADO) },
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- 7. Control tras el termosellado --------------------------------
        composable(Rutas.POST_TERMOSELLADO) {
            val modelo: ControlPostTermoselladoViewModel = viewModel(
                factory = fabricaDe {
                    ControlPostTermoselladoViewModel(
                        lector = contenedor.lectorNfc,
                        flujoUnidad = contenedor.flujoUnidad,
                        control = contenedor.controlPostTermosellado,
                        modoSimulacion = { contenedor.modoSimulacion.value },
                    )
                },
            )
            PantallaControlPostTermosellado(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alVolverAOrdenes = {
                    navegador.navigate(Rutas.ORDENES) {
                        popUpTo(Rutas.ORDENES) { inclusive = true }
                    }
                },
                alSiguienteUnidad = {
                    // Vuelve a la programación de la MISMA orden, con claves de
                    // idempotencia nuevas (las genera el ViewModel al avanzar).
                    navegador.navigate(Rutas.PROGRAMACION) {
                        popUpTo(Rutas.PROGRAMACION) { inclusive = true }
                    }
                },
                alAbrirCuarentena = { navegador.navigate(Rutas.CUARENTENA) },
            )
        }

        // --- Transversal: verificación --------------------------------------
        composable(Rutas.VERIFICACION) {
            val modelo: VerificacionViewModel = viewModel(
                factory = fabricaDe {
                    VerificacionViewModel(
                        lector = contenedor.lectorNfc,
                        verificarChip = contenedor.verificarChip,
                        modoSimulacion = { contenedor.modoSimulacion.value },
                    )
                },
            )
            PantallaVerificacion(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- Transversal: historial del turno -------------------------------
        composable(Rutas.HISTORIAL) {
            val modelo: HistorialViewModel = viewModel(
                factory = fabricaDe { HistorialViewModel(contenedor.repositorioHistorial) },
            )
            PantallaHistorialOperario(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- Transversal: pendientes de enviar ------------------------------
        composable(Rutas.ERRORES) {
            val modelo: ErroresViewModel = viewModel(
                factory = fabricaDe {
                    ErroresViewModel(
                        repositorioReintentos = contenedor.repositorioReintentos,
                        repositorioProduccion = contenedor.repositorioProduccion,
                    )
                },
            )
            PantallaErroresYReintentos(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- Transversal: cuarentena ----------------------------------------
        composable(Rutas.CUARENTENA) {
            val modelo: CuarentenaViewModel = viewModel(
                factory = fabricaDe {
                    CuarentenaViewModel(
                        flujoUnidad = contenedor.flujoUnidad,
                        repositorioProduccion = contenedor.repositorioProduccion,
                        repositorioHistorial = contenedor.repositorioHistorial,
                    )
                },
            )
            PantallaCuarentena(
                modelo = modelo,
                modoSimulacion = modoSimulacion,
                alTerminar = {
                    navegador.navigate(Rutas.PROGRAMACION) {
                        popUpTo(Rutas.PROGRAMACION) { inclusive = true }
                    }
                },
                alVolver = { navegador.popBackStack() },
            )
        }

        // --- Transversal: configuración -------------------------------------
        composable(Rutas.CONFIGURACION) {
            val modelo: ConfiguracionViewModel = viewModel(
                factory = fabricaDe {
                    ConfiguracionViewModel(
                        preferencias = contenedor.preferencias,
                        repositorioAutenticacion = contenedor.repositorioAutenticacion,
                        lector = contenedor.lectorNfc,
                        proveedorAtestacion = contenedor.proveedorAtestacion,
                    )
                },
            )
            PantallaConfiguracion(
                modelo = modelo,
                alCerrarSesion = {
                    contenedor.flujoUnidad.limpiar()
                    navegador.navigate(Rutas.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                alVolver = { navegador.popBackStack() },
            )
        }
    }
}
