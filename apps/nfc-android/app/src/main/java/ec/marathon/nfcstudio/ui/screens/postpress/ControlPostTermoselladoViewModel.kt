package ec.marathon.nfcstudio.ui.screens.postpress

import android.nfc.Tag
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.EstadoFlujoUnidad
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.domain.model.MedicionTermosellado
import ec.marathon.nfcstudio.domain.usecase.ControlPostTermosellado
import ec.marathon.nfcstudio.nfc.AndroidTagTransport
import ec.marathon.nfcstudio.nfc.DetectorTipoChip
import ec.marathon.nfcstudio.nfc.EstadoNfcTelefono
import ec.marathon.nfcstudio.nfc.FabricaProveedores
import ec.marathon.nfcstudio.nfc.LectorNfcAndroid
import ec.marathon.nfcstudio.nfc.MockNfcProvider
import ec.marathon.nfcstudio.nfc.PersonalizationPlan
import ec.marathon.nfcstudio.nfc.TagDetection
import ec.marathon.nfcstudio.nfc.TagSimulado
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel del control posterior al termosellado.
 *
 * Último paso del flujo. Aquí la unidad se ACTIVA o pasa a CUARENTENA; no hay
 * opción intermedia ni forma de saltarse el control.
 *
 * Los parámetros de la prensa (temperatura, presión, duración) se introducen a
 * mano porque la prensa no está conectada a nada. Son OPCIONALES: si el operario
 * los deja vacíos se envían nulos, y el sistema registra el control igualmente.
 * Exigirlos convertiría un dato de trazabilidad deseable en un bloqueo de línea,
 * y la consecuencia previsible sería que alguien empezara a teclear "180" siempre.
 */
class ControlPostTermoselladoViewModel(
    private val lector: LectorNfcAndroid,
    private val flujoUnidad: EstadoFlujoUnidad,
    private val control: ControlPostTermosellado,
    private val modoSimulacion: () -> Boolean,
) : ViewModel() {

    sealed interface EstadoUi {

        data object SinUnidad : EstadoUi

        data class Esperando(
            val referenciaPublica: String,
            val estadoNfc: EstadoNfcTelefono,
            val simulacion: Boolean,
            val mensaje: String,
            val temperatura: String = "",
            val presion: String = "",
            val duracion: String = "",
        ) : EstadoUi

        data object Comprobando : EstadoUi

        data class Resuelto(
            val aprobado: Boolean,
            val mensajeOperario: String,
            val detalleTecnico: String,
            val estadoFinal: String,
            val simulacion: Boolean,
        ) : EstadoUi

        data class Fallo(val error: ErrorApp, val referenciaPublica: String) : EstadoUi
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.SinUnidad)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    private var trabajo: Job? = null

    init {
        val datos = flujoUnidad.estado.value
        _estado.value = if (!datos.listaParaPostTermosellado) {
            EstadoUi.SinUnidad
        } else {
            EstadoUi.Esperando(
                referenciaPublica = datos.unidad?.referenciaPublica ?: "",
                estadoNfc = lector.estado.value,
                simulacion = datos.simulado,
                mensaje = mensaje(lector.estado.value, datos.simulado),
            )
        }

        viewModelScope.launch {
            lector.tags.collect { tag -> comprobar(tag) }
        }
    }

    private fun mensaje(estadoNfc: EstadoNfcTelefono, simulacion: Boolean): String = when {
        simulacion -> "Modo simulación. Pulse «Comprobar emblema simulado»."
        estadoNfc == EstadoNfcTelefono.LISTO ->
            "El jersey ya pasó por la prensa. Apoye el emblema otra vez, sin moverlo."
        else -> estadoNfc.instruccion
    }

    fun cambiarTemperatura(valor: String) = actualizarCampos { it.copy(temperatura = valor) }
    fun cambiarPresion(valor: String) = actualizarCampos { it.copy(presion = valor) }
    fun cambiarDuracion(valor: String) = actualizarCampos { it.copy(duracion = valor) }

    private fun actualizarCampos(transformacion: (EstadoUi.Esperando) -> EstadoUi.Esperando) {
        val actual = _estado.value
        if (actual is EstadoUi.Esperando) _estado.value = transformacion(actual)
    }

    private fun medicionActual(): MedicionTermosellado {
        val actual = _estado.value as? EstadoUi.Esperando
            ?: return MedicionTermosellado(null, null, null)
        return MedicionTermosellado(
            // `toDoubleOrNull` en lugar de validación: un campo vacío o mal
            // escrito se envía como nulo, no bloquea el control de calidad.
            temperaturaC = actual.temperatura.replace(',', '.').toDoubleOrNull(),
            presionBar = actual.presion.replace(',', '.').toDoubleOrNull(),
            duracionSeg = actual.duracion.toIntOrNull(),
        )
    }

    private fun comprobar(tag: Tag) {
        if (trabajo?.isActive == true) return
        val actual = _estado.value
        if (actual !is EstadoUi.Esperando || actual.simulacion) return

        val datos = flujoUnidad.estado.value
        val trabajoProgramacion = datos.trabajo ?: return
        val unidad = datos.unidad ?: return
        val medicion = medicionActual()

        trabajo = viewModelScope.launch {
            _estado.value = EstadoUi.Comprobando
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
                    proveedorSolicitado = trabajoProgramacion.proveedorId,
                    transporte = transporte,
                    deteccion = deteccion,
                )
                if (proveedor == null) {
                    _estado.value = EstadoUi.Fallo(
                        ErrorApp.de(
                            ec.marathon.nfcstudio.core.CodigoError.NO_IMPLEMENTADO,
                            "Sin proveedor para ${tipo.name}",
                        ),
                        unidad.referenciaPublica,
                    )
                    return@launch
                }

                val resultado = control.ejecutar(
                    proveedor = proveedor,
                    deteccion = deteccion,
                    uriEsperada = trabajoProgramacion.uriDestino,
                    codigoOrden = datos.orden?.codigo ?: "",
                    idUnidad = unidad.idUnidad,
                    medicion = medicion,
                    claves = datos.claves,
                )

                _estado.value = when (resultado) {
                    is Resultado.Exito -> EstadoUi.Resuelto(
                        aprobado = resultado.valor.aprobado,
                        mensajeOperario = resultado.valor.mensajeOperario,
                        detalleTecnico = resultado.valor.prueba.detail,
                        estadoFinal = resultado.valor.estadoFinal?.etiquetaOperario ?: "Sin estado",
                        simulacion = datos.simulado,
                    )

                    is Resultado.Fallo -> EstadoUi.Fallo(
                        resultado.error,
                        unidad.referenciaPublica,
                    )
                }
            } finally {
                runCatching { transporte.close() }
            }
        }
    }

    /** Ensayo sin hardware: recorre el control completo con el simulador. */
    fun comprobarSimulado(fallarLectura: Boolean = false) {
        if (trabajo?.isActive == true) return
        val datos = flujoUnidad.estado.value
        val trabajoProgramacion = datos.trabajo ?: return
        val unidad = datos.unidad ?: return
        val medicion = medicionActual()

        trabajo = viewModelScope.launch {
            _estado.value = EstadoUi.Comprobando
            val proveedor = MockNfcProvider(
                MockNfcProvider.OpcionesSimulador(
                    tag = TagSimulado.crear(),
                    fallarTrasTermosellado = fallarLectura,
                ),
            )
            val deteccion = proveedor.detectTag()
            // Se graba el contenido esperado para que la comprobación tenga algo
            // que comparar, igual que ocurriría con un chip real ya programado.
            val inspeccion = proveedor.inspectTag(deteccion)
            proveedor.writeNdef(
                inspeccion,
                PersonalizationPlan(
                    jobId = trabajoProgramacion.idTrabajo,
                    uri = trabajoProgramacion.uriDestino,
                    keyReferences = emptyList(),
                    lockPlan = trabajoProgramacion.planBloqueo,
                ),
            )

            val resultado = control.ejecutar(
                proveedor = proveedor,
                deteccion = deteccion,
                uriEsperada = trabajoProgramacion.uriDestino,
                codigoOrden = datos.orden?.codigo ?: "",
                idUnidad = unidad.idUnidad,
                medicion = medicion,
                claves = datos.claves,
            )

            _estado.value = when (resultado) {
                is Resultado.Exito -> EstadoUi.Resuelto(
                    aprobado = resultado.valor.aprobado,
                    mensajeOperario = resultado.valor.mensajeOperario,
                    detalleTecnico = resultado.valor.prueba.detail,
                    estadoFinal = resultado.valor.estadoFinal?.etiquetaOperario ?: "Sin estado",
                    simulacion = true,
                )

                is Resultado.Fallo -> EstadoUi.Fallo(resultado.error, unidad.referenciaPublica)
            }
        }
    }

    /** Prepara la siguiente unidad con claves de idempotencia nuevas. */
    fun siguienteUnidad() {
        flujoUnidad.siguienteUnidad()
    }

    fun volverAEsperar() {
        val datos = flujoUnidad.estado.value
        _estado.value = EstadoUi.Esperando(
            referenciaPublica = datos.unidad?.referenciaPublica ?: "",
            estadoNfc = lector.estado.value,
            simulacion = datos.simulado,
            mensaje = mensaje(lector.estado.value, datos.simulado),
        )
    }
}
