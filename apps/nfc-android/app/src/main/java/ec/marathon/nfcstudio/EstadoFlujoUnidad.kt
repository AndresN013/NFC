package ec.marathon.nfcstudio

import ec.marathon.nfcstudio.core.ClavesDeUnidad
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import ec.marathon.nfcstudio.domain.model.TrabajoProgramacion
import ec.marathon.nfcstudio.domain.model.UnidadVinculada
import ec.marathon.nfcstudio.nfc.TagDetection
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Estado de la unidad que el operario esta procesando AHORA.
 *
 * Programación, Asociación con jersey y Control post-termosellado son tres
 * pantallas de una misma unidad fisica. Este objeto es su memoria compartida.
 *
 * SEGURIDAD: la URI de destino (que contiene el token grabado en el chip) vive
 * aqui, en memoria, y NO se pasa como argumento de navegacion. Los argumentos de
 * navegacion de Compose acaban en el `back stack` guardado por el sistema, que se
 * serializa y puede quedar en disco cuando el proceso se mata. Un token de chip
 * en un `savedInstanceState` es un token en disco sin cifrar.
 *
 * Al terminar o abandonar una unidad se llama a [limpiar], que borra la URI y
 * genera claves de idempotencia nuevas para la siguiente.
 */
class EstadoFlujoUnidad {

    private val _estado = MutableStateFlow(DatosUnidad())
    val estado: StateFlow<DatosUnidad> = _estado.asStateFlow()

    data class DatosUnidad(
        val orden: OrdenProduccion? = null,
        val deteccion: TagDetection? = null,
        val trabajo: TrabajoProgramacion? = null,
        val unidad: UnidadVinculada? = null,
        val codigoEmblema: String = "",
        val codigoBarrasJersey: String = "",
        /** Claves de idempotencia del intento logico en curso. */
        val claves: ClavesDeUnidad = ClavesDeUnidad.nuevas(),
        val simulado: Boolean = false,
    ) {
        val listaParaVincular: Boolean get() = trabajo != null
        val listaParaPostTermosellado: Boolean get() = unidad != null && trabajo != null
    }

    fun iniciarUnidad(orden: OrdenProduccion, simulado: Boolean) {
        // Claves NUEVAS: es un intento logico nuevo, con otro contenido.
        _estado.value = DatosUnidad(orden = orden, simulado = simulado)
    }

    fun registrarDeteccion(deteccion: TagDetection) {
        _estado.value = _estado.value.copy(deteccion = deteccion)
    }

    fun registrarTrabajo(trabajo: TrabajoProgramacion) {
        _estado.value = _estado.value.copy(trabajo = trabajo)
    }

    fun registrarCodigos(codigoEmblema: String, codigoBarrasJersey: String) {
        _estado.value = _estado.value.copy(
            codigoEmblema = codigoEmblema,
            codigoBarrasJersey = codigoBarrasJersey,
        )
    }

    fun registrarUnidad(unidad: UnidadVinculada) {
        _estado.value = _estado.value.copy(unidad = unidad)
    }

    /**
     * Limpia la unidad conservando la orden, que es lo que el operario sigue
     * trabajando. Las claves de idempotencia se renuevan.
     */
    fun siguienteUnidad() {
        val orden = _estado.value.orden
        val simulado = _estado.value.simulado
        _estado.value = DatosUnidad(orden = orden, simulado = simulado)
    }

    fun limpiar() {
        _estado.value = DatosUnidad()
    }
}
