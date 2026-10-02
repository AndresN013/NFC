package ec.marathon.nfcstudio.ui.screens.estadonfc

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.data.session.SesionOperario
import ec.marathon.nfcstudio.nfc.EstadoNfcTelefono
import ec.marathon.nfcstudio.nfc.LectorNfcAndroid
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * ViewModel del segundo paso del flujo: comprobar que ESTE teléfono puede
 * trabajar.
 *
 * Dos comprobaciones distintas que la pantalla no debe confundir:
 *
 *  1. HARDWARE: el teléfono tiene antena NFC y está encendida. Lo sabe el
 *     propio dispositivo.
 *  2. AUTORIZACION: el SERVIDOR tiene este teléfono dado de alta como puesto de
 *     programación. Esto no lo decide la app; la app solo transmite lo que el
 *     servidor respondió en el login, y falla cerrado si no dijo nada.
 *
 * Un teléfono puede tener NFC perfecto y no estar autorizado, y en ese caso NO
 * debe programar: si lo hiciera, se perdería la trazabilidad de qué puesto grabó
 * cada unidad.
 */
class EstadoNfcViewModel(
    private val lector: LectorNfcAndroid,
    private val preferencias: PreferenciasApp,
    private val sesionActual: () -> SesionOperario?,
) : ViewModel() {

    sealed interface EstadoUi {

        data object Comprobando : EstadoUi

        data class Resuelto(
            val estadoNfc: EstadoNfcTelefono,
            val dispositivoAutorizado: Boolean,
            val etiquetaDispositivo: String?,
            val idDispositivo: String,
            val modoSimulacion: Boolean,
            val nombreOperario: String,
        ) : EstadoUi {

            /** Solo con ambas condiciones se puede grabar de verdad. */
            val puedeProgramarReal: Boolean
                get() = estadoNfc == EstadoNfcTelefono.LISTO && dispositivoAutorizado

            /** En simulación se puede practicar aunque no haya antena. */
            val puedeContinuar: Boolean
                get() = puedeProgramarReal || modoSimulacion

            val motivoBloqueo: String?
                get() = when {
                    puedeContinuar -> null
                    estadoNfc != EstadoNfcTelefono.LISTO -> estadoNfc.instruccion
                    !dispositivoAutorizado ->
                        "Este teléfono no está habilitado como puesto de programación. " +
                            "Entréguelo al supervisor para que lo dé de alta, o active el " +
                            "modo simulación si solo va a practicar."
                    else -> null
                }
        }
    }

    private val _estado = MutableStateFlow<EstadoUi>(EstadoUi.Comprobando)
    val estado: StateFlow<EstadoUi> = _estado.asStateFlow()

    init {
        viewModelScope.launch {
            combine(
                lector.estado,
                preferencias.modoSimulacion,
                preferencias.idDispositivo,
            ) { estadoNfc, simulacion, idDispositivo ->
                val sesion = sesionActual()
                EstadoUi.Resuelto(
                    estadoNfc = estadoNfc,
                    // Fallar cerrado: sin sesion, no autorizado.
                    dispositivoAutorizado = sesion?.dispositivoAutorizado ?: false,
                    etiquetaDispositivo = sesion?.etiquetaDispositivo,
                    idDispositivo = idDispositivo,
                    modoSimulacion = simulacion,
                    nombreOperario = sesion?.nombreMostrable ?: "",
                )
            }.collect { _estado.value = it }
        }
    }

    /** El operario vuelve de los ajustes del sistema tras encender el NFC. */
    fun refrescar() = lector.refrescarEstado()

    fun cambiarModoSimulacion(activo: Boolean) {
        viewModelScope.launch { preferencias.guardarModoSimulacion(activo) }
    }
}
