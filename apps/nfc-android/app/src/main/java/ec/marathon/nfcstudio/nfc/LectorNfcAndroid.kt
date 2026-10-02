package ec.marathon.nfcstudio.nfc

import android.app.Activity
import android.content.Context
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import ec.marathon.nfcstudio.core.Registro
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/** Estado del subsistema NFC del telefono. */
enum class EstadoNfcTelefono {
    /** El telefono no tiene antena NFC. Solo cabe el modo simulación. */
    SIN_HARDWARE,

    /** Tiene antena pero el usuario la tiene apagada. */
    APAGADO,

    /** Listo para leer. */
    LISTO,
    ;

    val titulo: String
        get() = when (this) {
            SIN_HARDWARE -> "Este teléfono no tiene lector NFC"
            APAGADO -> "El NFC está apagado"
            LISTO -> "Lector NFC listo"
        }

    val instruccion: String
        get() = when (this) {
            SIN_HARDWARE ->
                "No es posible programar emblemas con este equipo. Puede usarlo únicamente " +
                    "en modo simulación, para practicar. Solicite al supervisor un teléfono habilitado."
            APAGADO ->
                "Abra los ajustes del teléfono, active el NFC y vuelva a esta pantalla."
            LISTO ->
                "Apoye el emblema contra la parte de atrás del teléfono, en el centro, y no lo mueva."
        }
}

/**
 * Lector NFC en MODO LECTOR (`enableReaderMode`).
 *
 * Por que modo lector y no intent-filters:
 *  - El sistema no muestra el dialogo "elegir aplicación" ni lanza otra app.
 *  - Se puede desactivar el sonido de descubrimiento de la plataforma para usar
 *    el sonido propio de la app, que es el que el operario aprende a reconocer.
 *  - La Activity no se recrea en cada acercamiento, asi que el estado del flujo
 *    de programacion sobrevive.
 *
 * Se activa SOLO mientras una pantalla que necesita leer esta en primer plano.
 * Mantenerlo activo todo el tiempo gasta bateria y captura tags por accidente,
 * por ejemplo la tarjeta de acceso del operario que lleva en el bolsillo.
 */
class LectorNfcAndroid(contexto: Context) {

    private val adaptador: NfcAdapter? = NfcAdapter.getDefaultAdapter(contexto.applicationContext)

    private val _estado = MutableStateFlow(calcularEstado())
    val estado: StateFlow<EstadoNfcTelefono> = _estado.asStateFlow()

    /**
     * Tags detectados.
     *
     * `extraBufferCapacity = 1` y `DROP_OLDEST`: si el operario apoya dos
     * emblemas muy seguidos interesa el ultimo, no encolar una cola de trabajo
     * que acabe grabando un chip que ya no esta en el campo.
     */
    private val _tags = MutableSharedFlow<Tag>(
        replay = 0,
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val tags: SharedFlow<Tag> = _tags.asSharedFlow()

    val hayHardware: Boolean get() = adaptador != null

    fun refrescarEstado() {
        _estado.value = calcularEstado()
    }

    private fun calcularEstado(): EstadoNfcTelefono = when {
        adaptador == null -> EstadoNfcTelefono.SIN_HARDWARE
        !adaptador.isEnabled -> EstadoNfcTelefono.APAGADO
        else -> EstadoNfcTelefono.LISTO
    }

    /**
     * Activa el modo lector. Debe llamarse desde `onResume` de la Activity.
     *
     * Banderas elegidas:
     *  - NFC_A: la familia NTAG es ISO/IEC 14443 tipo A. No se habilitan otras
     *    tecnologias para no capturar tarjetas ajenas al proceso.
     *  - SKIP_NDEF_CHECK: evita que la plataforma lea el NDEF antes de
     *    entregarnos el tag. Ahorra una transaccion y, sobre todo, evita que un
     *    tag sin formatear se descarte antes de llegar a nosotros.
     *  - NO_PLATFORM_SOUNDS: el sonido lo da la app en el momento correcto (al
     *    terminar la comprobacion, no al detectar), que es lo que el operario
     *    necesita oir.
     */
    fun activarModoLector(actividad: Activity) {
        val adaptadorLocal = adaptador ?: return
        val extras = Bundle().apply {
            // Retardo del chequeo de presencia. Un valor alto reduce los falsos
            // "se perdió el contacto" cuando la mano tiembla, a costa de tardar
            // mas en detectar que el emblema se retiro de verdad.
            putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, RETARDO_PRESENCIA_MS)
        }
        adaptadorLocal.enableReaderMode(
            actividad,
            { tag -> alDetectarTag(tag) },
            NfcAdapter.FLAG_READER_NFC_A or
                NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or
                NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
            extras,
        )
        refrescarEstado()
        Registro.depuracion(ETIQUETA, "Modo lector activado.")
    }

    /** Debe llamarse desde `onPause` de la Activity. */
    fun desactivarModoLector(actividad: Activity) {
        adaptador?.disableReaderMode(actividad)
        Registro.depuracion(ETIQUETA, "Modo lector desactivado.")
    }

    private fun alDetectarTag(tag: Tag) {
        // El callback llega en un hilo de la pila NFC, nunca en el principal.
        // Solo se publica el tag; toda la comunicacion la hace el proveedor.
        Registro.depuracion(ETIQUETA, "Etiqueta detectada, tecnologías=${tag.techList.size}")
        _tags.tryEmit(tag)
    }

    private companion object {
        const val ETIQUETA = "LectorNfc"
        const val RETARDO_PRESENCIA_MS = 500
    }
}
