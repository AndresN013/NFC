package ec.marathon.nfcstudio.ui.screens.programacion

import android.nfc.Tag
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.EstadoFlujoUnidad
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.domain.model.ConsultaChip
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import ec.marathon.nfcstudio.domain.model.PasoProceso
import ec.marathon.nfcstudio.domain.model.TipoChip
import ec.marathon.nfcstudio.domain.model.TrabajoProgramacion
import ec.marathon.nfcstudio.domain.usecase.AvanceProgramacion
import ec.marathon.nfcstudio.domain.usecase.ProgramarChip
import ec.marathon.nfcstudio.nfc.AndroidTagTransport
import ec.marathon.nfcstudio.nfc.DetectorTipoChip
import ec.marathon.nfcstudio.nfc.EstadoNfcTelefono
import ec.marathon.nfcstudio.nfc.FabricaProveedores
import ec.marathon.nfcstudio.nfc.LectorNfcAndroid
import ec.marathon.nfcstudio.nfc.NfcPersonalizationProvider
import ec.marathon.nfcstudio.nfc.TagDetection
import ec.marathon.nfcstudio.nfc.TagInspection
import ec.marathon.nfcstudio.ui.components.EstadoPaso
import ec.marathon.nfcstudio.ui.components.PASOS_PROGRAMACION
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel de la pantalla de programación. Es el corazón de la aplicación.
 *
 * RESPONSABILIDADES
 *  - Esperar a que aparezca un emblema en el campo del lector (o simularlo).
 *  - Identificar la familia del chip.
 *  - Lanzar el caso de uso [ProgramarChip], que contiene el orden obligatorio de
 *    los pasos, y traducir su avance a estado de interfaz.
 *  - Conservar las claves de idempotencia del intento para que "Reintentar" sea
 *    de verdad el MISMO intento a ojos del servidor.
 *
 * LO QUE ESTA PANTALLA NO HACE, Y NO PUEDE HACER
 *  - No elige la URI ni el identificador: los pide al servidor.
 *  - No introduce claves. No existe ningún campo de texto en esta pantalla, ni en
 *    ninguna otra, donde un operario pueda teclear material criptográfico. Es una
 *    decisión de diseño, no un olvido: un campo así convertiría cualquier
 *    filtración de clave en un incidente irreversible y haría inútil el custodio.
 */
class ProgramacionViewModel(
    private val lector: LectorNfcAndroid,
    private val flujoUnidad: EstadoFlujoUnidad,
    private val programarChip: ProgramarChip,
    private val modoSimulacion: () -> Boolean,
) : ViewModel() {

    sealed interface EstadoUi {

        /** No hay orden seleccionada: no se debe haber llegado aquí. */
        data object SinOrden : EstadoUi

        data class Esperando(
            val orden: OrdenProduccion,
            val estadoNfc: EstadoNfcTelefono,
            val simulacion: Boolean,
            val mensaje: String,
        ) : EstadoUi

        data class EnCurso(
            val orden: OrdenProduccion,
            val estadosPaso: Map<PasoProceso, EstadoPaso>,
            val mensaje: String,
            val inspeccion: TagInspection? = null,
            val consulta: ConsultaChip? = null,
            val trabajo: TrabajoProgramacion? = null,
            val advertencia: String? = null,
            val simulacion: Boolean = false,
        ) : EstadoUi

        data class Completada(
            val orden: OrdenProduccion,
            val trabajo: TrabajoProgramacion,
            val inspeccion: TagInspection,
            val uriGrabada: String,
            val simulacion: Boolean,
        ) : EstadoUi

        data class Fallo(
            val orden: OrdenProduccion,
            val paso: PasoProceso,
            val estadosPaso: Map<PasoProceso, EstadoPaso>,
            val mensajeOperario: String,
            val reintentable: Boolean,
            val errorServidor: ErrorApp? = null,
            val simulacion: Boolean = false,
        ) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.SinOrden)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    /** Transporte del tag en curso. Se cierra siempre al terminar. */
    private var transporte: AndroidTagTransport? = null
    private var trabajoEnCurso: Job? = null

    init {
        viewModelScope.launch {
            // La orden viene del estado compartido, no de un argumento de
            // navegación: así la URI del chip nunca entra en el back stack.
            val datos = flujoUnidad.estado.value
            val orden = datos.orden
            _estado.value = if (orden == null) {
                EstadoUi.SinOrden
            } else {
                EstadoUi.Esperando(
                    orden = orden,
                    estadoNfc = lector.estado.value,
                    simulacion = modoSimulacion(),
                    mensaje = mensajeDeEspera(lector.estado.value, modoSimulacion()),
                )
            }
        }

        // Etiquetas detectadas por el modo lector.
        viewModelScope.launch {
            lector.tags.collect { tag -> alAparecerEmblema(tag) }
        }

        viewModelScope.launch {
            lector.estado.collect { estadoNfc ->
                val actual = _estado.value
                if (actual is EstadoUi.Esperando) {
                    _estado.value = actual.copy(
                        estadoNfc = estadoNfc,
                        mensaje = mensajeDeEspera(estadoNfc, actual.simulacion),
                    )
                }
            }
        }
    }

    private fun mensajeDeEspera(estadoNfc: EstadoNfcTelefono, simulacion: Boolean): String = when {
        simulacion ->
            "Modo simulación. Pulse «Simular emblema» para practicar el proceso completo."
        estadoNfc == EstadoNfcTelefono.LISTO ->
            "Apoye el emblema contra la parte de atrás del teléfono, en el centro, " +
                "y no lo mueva hasta que suene."
        else -> estadoNfc.instruccion
    }

    /**
     * Un emblema entró en el campo.
     *
     * Se ignora si ya hay una operación en curso: dos escrituras simultáneas sobre
     * el mismo trabajo es exactamente el escenario que la idempotencia intenta
     * evitar, y aquí se puede evitar antes.
     */
    private fun alAparecerEmblema(tag: Tag) {
        if (trabajoEnCurso?.isActive == true) {
            Registro.depuracion(ETIQUETA, "Etiqueta ignorada: ya hay una operación en curso.")
            return
        }
        val actual = _estado.value
        if (actual !is EstadoUi.Esperando) return
        if (actual.simulacion) return // en simulación no se atiende hardware

        val nuevoTransporte = AndroidTagTransport(tag)
        transporte = nuevoTransporte

        trabajoEnCurso = viewModelScope.launch {
            try {
                // --- Identificación de la familia del chip -------------------
                val tipo = DetectorTipoChip.detectar(nuevoTransporte)
                val deteccion = TagDetection(
                    uid = nuevoTransporte.uidHex(),
                    chipType = tipo,
                    technologies = nuevoTransporte.tecnologias(),
                )
                flujoUnidad.registrarDeteccion(deteccion)

                val proveedor = FabricaProveedores.crear(
                    modoSimulacion = false,
                    // El proveedor definitivo lo dicta el servidor en la reserva;
                    // aquí se monta el que corresponde al chip detectado y el caso
                    // de uso comprueba después que ambos coincidan.
                    proveedorSolicitado = null,
                    transporte = nuevoTransporte,
                    deteccion = deteccion,
                )

                if (proveedor == null) {
                    fallar(
                        actual.orden,
                        PasoProceso.DETECCION,
                        "No sabemos manejar este tipo de emblema. Aparte la unidad.",
                        reintentable = false,
                    )
                    return@launch
                }

                ejecutarFlujo(actual.orden, proveedor)
            } finally {
                // Cerrar siempre: dejar la conexión abierta impide que el
                // siguiente emblema se detecte.
                runCatching { transporte?.close() }
                transporte = null
            }
        }
    }

    /** Modo simulación: el operario dispara el ciclo sin hardware. */
    fun simularEmblema(
        fallarEscritura: Boolean = false,
        corromperRelectura: Boolean = false,
    ) {
        if (trabajoEnCurso?.isActive == true) return
        val actual = _estado.value
        if (actual !is EstadoUi.Esperando) return

        trabajoEnCurso = viewModelScope.launch {
            val proveedor = ec.marathon.nfcstudio.nfc.MockNfcProvider(
                ec.marathon.nfcstudio.nfc.MockNfcProvider.OpcionesSimulador(
                    tag = ec.marathon.nfcstudio.nfc.TagSimulado.crear(
                        tipoChip = actual.orden.tipoChipEsperado.takeIf { it != TipoChip.UNKNOWN }
                            ?: TipoChip.NTAG213,
                    ),
                    fallarEscritura = fallarEscritura,
                    corromperAlVerificar = corromperRelectura,
                    // Retardo para que el operario vea el avance de los pasos:
                    // en formación, un ciclo instantáneo no enseña nada.
                    retardoMs = 400L,
                ),
            )
            val deteccion = proveedor.detectTag()
            flujoUnidad.registrarDeteccion(deteccion)
            ejecutarFlujo(actual.orden, proveedor)
        }
    }

    private suspend fun ejecutarFlujo(
        orden: OrdenProduccion,
        proveedor: NfcPersonalizationProvider,
    ) {
        val simulacion = proveedor.capabilities.isSimulation
        val estados = PASOS_PROGRAMACION.associateWith { EstadoPaso.PENDIENTE }.toMutableMap()
        var inspeccion: TagInspection? = null
        var consulta: ConsultaChip? = null
        var trabajo: TrabajoProgramacion? = null
        var advertencia: String? = null

        // Las claves de idempotencia del intento en curso. NO se regeneran aquí:
        // vienen del estado compartido y sobreviven a los reintentos.
        val claves = flujoUnidad.estado.value.claves

        programarChip.ejecutar(proveedor, orden, claves).collect { avance ->
            when (avance) {
                is AvanceProgramacion.EnCurso -> {
                    estados[avance.paso] = EstadoPaso.EN_CURSO
                    _estado.value = EstadoUi.EnCurso(
                        orden = orden,
                        estadosPaso = estados.toMap(),
                        mensaje = avance.mensaje,
                        inspeccion = inspeccion,
                        consulta = consulta,
                        trabajo = trabajo,
                        advertencia = advertencia,
                        simulacion = simulacion,
                    )
                }

                is AvanceProgramacion.Advertencia -> {
                    advertencia = avance.mensaje
                }

                is AvanceProgramacion.ChipInspeccionado -> {
                    inspeccion = avance.inspeccion
                    estados[PasoProceso.DETECCION] = EstadoPaso.COMPLETADO
                    estados[PasoProceso.INSPECCION] = EstadoPaso.COMPLETADO
                }

                is AvanceProgramacion.ConsultaResuelta -> {
                    consulta = avance.consulta
                    estados[PasoProceso.CONSULTA_SERVIDOR] = EstadoPaso.COMPLETADO
                }

                is AvanceProgramacion.TrabajoReservado -> {
                    trabajo = avance.trabajo
                    flujoUnidad.registrarTrabajo(avance.trabajo)
                    estados[PasoProceso.RESERVA] = EstadoPaso.COMPLETADO
                }

                is AvanceProgramacion.Completado -> {
                    estados[PasoProceso.ESCRITURA] = EstadoPaso.COMPLETADO
                    estados[PasoProceso.RELECTURA] = EstadoPaso.COMPLETADO
                    _estado.value = EstadoUi.Completada(
                        orden = orden,
                        trabajo = avance.trabajo,
                        inspeccion = avance.inspeccion,
                        uriGrabada = avance.trabajo.uriDestino,
                        simulacion = avance.simulado,
                    )
                }

                is AvanceProgramacion.FalloNfc -> {
                    estados[avance.paso] = EstadoPaso.FALLIDO
                    _estado.value = EstadoUi.Fallo(
                        orden = orden,
                        paso = avance.paso,
                        estadosPaso = estados.toMap(),
                        mensajeOperario = avance.mensajeOperario,
                        reintentable = avance.reintentable,
                        simulacion = simulacion,
                    )
                }

                is AvanceProgramacion.FalloServidor -> {
                    estados[avance.paso] = EstadoPaso.FALLIDO
                    _estado.value = EstadoUi.Fallo(
                        orden = orden,
                        paso = avance.paso,
                        estadosPaso = estados.toMap(),
                        mensajeOperario = avance.mensajeOperario,
                        reintentable = avance.reintentable,
                        errorServidor = avance.error,
                        simulacion = simulacion,
                    )
                }

                is AvanceProgramacion.FalloOperacion -> {
                    estados[avance.paso] = EstadoPaso.FALLIDO
                    _estado.value = EstadoUi.Fallo(
                        orden = orden,
                        paso = avance.paso,
                        estadosPaso = estados.toMap(),
                        mensajeOperario = avance.mensajeOperario,
                        reintentable = avance.reintentable,
                        simulacion = simulacion,
                    )
                }
            }
        }
    }

    private fun fallar(
        orden: OrdenProduccion,
        paso: PasoProceso,
        mensaje: String,
        reintentable: Boolean,
    ) {
        _estado.value = EstadoUi.Fallo(
            orden = orden,
            paso = paso,
            estadosPaso = PASOS_PROGRAMACION.associateWith { paso2 ->
                if (paso2 == paso) EstadoPaso.FALLIDO else EstadoPaso.PENDIENTE
            },
            mensajeOperario = mensaje,
            reintentable = reintentable,
            simulacion = modoSimulacion(),
        )
    }

    /**
     * Vuelve a esperar el emblema SIN renovar las claves de idempotencia.
     *
     * Esto es lo que hace que un reintento sea seguro: el servidor reconoce la
     * clave del primer intento y, si aquella operación llegó a ejecutarse,
     * devuelve su resultado en lugar de repetir el efecto.
     */
    fun reintentarMismoIntento() {
        val orden = flujoUnidad.estado.value.orden ?: return
        _estado.value = EstadoUi.Esperando(
            orden = orden,
            estadoNfc = lector.estado.value,
            simulacion = modoSimulacion(),
            mensaje = mensajeDeEspera(lector.estado.value, modoSimulacion()),
        )
    }

    /**
     * Abandona esta unidad y prepara la siguiente con claves NUEVAS.
     *
     * Las claves cambian porque el contenido de la próxima operación también
     * cambia (otro chip). Reutilizarlas daría un conflicto 409 en el servidor.
     */
    fun siguienteUnidad() {
        flujoUnidad.siguienteUnidad()
        reintentarMismoIntento()
    }

    override fun onCleared() {
        super.onCleared()
        // No se puede cerrar el transporte aquí: `close()` es una operación
        // suspendida y `onCleared` no lo es. El cierre real ocurre siempre en el
        // bloque `finally` de la corrutina que abrió la conexión, que se ejecuta
        // también cuando `viewModelScope` se cancela al destruirse el ViewModel.
        transporte = null
    }

    private companion object {
        const val ETIQUETA = "Programacion"
    }
}
