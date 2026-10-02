package ec.marathon.nfcstudio.ui.screens.verificacion

import android.nfc.Tag
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.domain.model.TipoChip
import ec.marathon.nfcstudio.domain.usecase.VerificarChip
import ec.marathon.nfcstudio.nfc.AndroidTagTransport
import ec.marathon.nfcstudio.nfc.DetectorTipoChip
import ec.marathon.nfcstudio.nfc.EstadoNfcTelefono
import ec.marathon.nfcstudio.nfc.FabricaProveedores
import ec.marathon.nfcstudio.nfc.LectorNfcAndroid
import ec.marathon.nfcstudio.nfc.NfcOperationException
import ec.marathon.nfcstudio.nfc.TagDetection
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel de la pantalla de verificación (lectura de comprobación).
 *
 * Lee el emblema igual que lo haría el teléfono de un aficionado y muestra el
 * nivel de confianza REAL. Es una herramienta de control de calidad y, sobre
 * todo, una herramienta pedagógica: enseña en planta que una NTAG 21x identifica
 * pero no autentica.
 */
class VerificacionViewModel(
    private val lector: LectorNfcAndroid,
    private val verificarChip: VerificarChip,
    private val modoSimulacion: () -> Boolean,
) : ViewModel() {

    sealed interface EstadoUi {

        data class Esperando(
            val estadoNfc: EstadoNfcTelefono,
            val simulacion: Boolean,
            val mensaje: String,
        ) : EstadoUi

        data object Leyendo : EstadoUi

        data class Leido(
            val lectura: VerificarChip.Lectura,
            val tipoChip: TipoChip,
            val tecnologias: List<String>,
        ) : EstadoUi

        data class Fallo(val mensajeOperario: String) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(
        EstadoUi.Esperando(
            estadoNfc = lector.estado.value,
            simulacion = modoSimulacion(),
            mensaje = mensaje(lector.estado.value, modoSimulacion()),
        ),
    )
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    private var trabajo: Job? = null

    init {
        viewModelScope.launch {
            lector.tags.collect { tag -> leer(tag) }
        }
        viewModelScope.launch {
            lector.estado.collect { estadoNfc ->
                val actual = _estado.value
                if (actual is EstadoUi.Esperando) {
                    _estado.value = actual.copy(
                        estadoNfc = estadoNfc,
                        mensaje = mensaje(estadoNfc, actual.simulacion),
                    )
                }
            }
        }
    }

    private fun mensaje(estadoNfc: EstadoNfcTelefono, simulacion: Boolean): String = when {
        simulacion -> "Modo simulación. Pulse «Leer emblema simulado»."
        estadoNfc == EstadoNfcTelefono.LISTO ->
            "Apoye el emblema para comprobar qué se puede leer de él."
        else -> estadoNfc.instruccion
    }

    private fun leer(tag: Tag) {
        if (trabajo?.isActive == true) return
        if (modoSimulacion()) return

        trabajo = viewModelScope.launch {
            _estado.value = EstadoUi.Leyendo
            val transporte = AndroidTagTransport(tag)
            try {
                val tipo = DetectorTipoChip.detectar(transporte)
                val deteccion = TagDetection(
                    uid = transporte.uidHex(),
                    chipType = tipo,
                    technologies = transporte.tecnologias(),
                )
                val proveedor = FabricaProveedores.crear(
                    modoSimulacion = false,
                    proveedorSolicitado = null,
                    transporte = transporte,
                    deteccion = deteccion,
                )
                if (proveedor == null) {
                    _estado.value = EstadoUi.Fallo(
                        "No sabemos leer este tipo de emblema.",
                    )
                    return@launch
                }
                val lectura = verificarChip.ejecutar(proveedor, deteccion)
                _estado.value = EstadoUi.Leido(
                    lectura = lectura,
                    tipoChip = tipo,
                    tecnologias = deteccion.technologies,
                )
            } catch (error: NfcOperationException) {
                _estado.value = EstadoUi.Fallo(error.info.operatorMessage)
            } catch (error: NotImplementedError) {
                // El proveedor de chips seguros todavía no está implementado y lo
                // dice lanzando NotImplementedError. Se traduce, no se oculta.
                Registro.advertencia(ETIQUETA, "Proveedor sin implementar: ${error.message}")
                _estado.value = EstadoUi.Fallo(
                    "Este equipo todavía no puede leer este tipo de emblema seguro.",
                )
            } finally {
                runCatching { transporte.close() }
            }
        }
    }

    fun leerSimulado() {
        if (trabajo?.isActive == true) return
        trabajo = viewModelScope.launch {
            _estado.value = EstadoUi.Leyendo
            val proveedor = ec.marathon.nfcstudio.nfc.MockNfcProvider()
            val deteccion = proveedor.detectTag()
            // Se graba algo primero para que la lectura tenga sentido: un tag
            // simulado recién creado está en blanco.
            val inspeccion = proveedor.inspectTag(deteccion)
            proveedor.writeNdef(
                inspeccion,
                ec.marathon.nfcstudio.nfc.PersonalizationPlan(
                    jobId = "ensayo",
                    uri = "https://escudo-vivo.marathon.ec/v/ENSAYO-SIMULADO",
                    keyReferences = emptyList(),
                    lockPlan = ec.marathon.nfcstudio.domain.model.PlanBloqueo(false, false),
                ),
            )
            val lectura = verificarChip.ejecutar(proveedor, deteccion)
            _estado.value = EstadoUi.Leido(
                lectura = lectura,
                tipoChip = deteccion.chipType,
                tecnologias = deteccion.technologies,
            )
        }
    }

    fun volverAEsperar() {
        _estado.value = EstadoUi.Esperando(
            estadoNfc = lector.estado.value,
            simulacion = modoSimulacion(),
            mensaje = mensaje(lector.estado.value, modoSimulacion()),
        )
    }

    private companion object {
        const val ETIQUETA = "Verificacion"
    }
}
