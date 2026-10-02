package ec.marathon.nfcstudio.data.repository

import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.core.RedactorDeSecretos
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.domain.model.EventoHistorial
import ec.marathon.nfcstudio.domain.model.PasoProceso
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Historial local del turno del operario.
 *
 * COPIA DE CONVENIENCIA, no fuente de verdad. La auditoria real vive en el
 * servidor (operario, telefono, fecha y resultado de cada operacion se envian
 * con cada llamada). Esto existe para que el operario pueda mirar su propio
 * turno cuando la nave se queda sin red, y para que un supervisor pueda revisar
 * un puesto concreto sin abrir el panel de administracion.
 *
 * SEGURIDAD: se guarda una HUELLA CORTA del UID, nunca el UID completo. El
 * historial no esta cifrado (esta en DataStore, no en el almacen seguro) porque
 * no debe contener nada que valga la pena robar. Si guardara UIDs, habria que
 * cifrarlo; es mas simple y mas seguro no guardarlos.
 */
class RepositorioHistorial(private val preferencias: PreferenciasApp) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    val eventos: Flow<List<EventoHistorial>> = preferencias.historialJson.map { texto ->
        decodificar(texto).map { it.aDominio() }.sortedByDescending { it.marcaTiempoMs }
    }

    suspend fun registrar(
        codigoOrden: String,
        uid: String?,
        paso: PasoProceso,
        exito: Boolean,
        detalle: String,
        simulado: Boolean,
    ) {
        val evento = EventoHistorial(
            idEvento = UUID.randomUUID().toString(),
            marcaTiempoMs = System.currentTimeMillis(),
            codigoOrden = codigoOrden,
            // Huella corta: permite correlacionar dos eventos del mismo emblema
            // sin almacenar el identificador del chip.
            huellaChip = RedactorDeSecretos.huellaCorta(uid),
            paso = paso,
            exito = exito,
            // El detalle tambien pasa por el redactor: un mensaje de error de
            // proveedor podria arrastrar una URI con el token.
            detalle = RedactorDeSecretos.redactar(detalle).take(240),
            simulado = simulado,
        )

        val actuales = decodificar(preferencias.historialJson.first()).toMutableList()
        actuales.add(evento.aDto())
        // Se limita el tamano: un turno son cientos de unidades, no miles, y un
        // historial ilimitado acabaria ralentizando el arranque de la app.
        val recortado = actuales.takeLast(MAXIMO_EVENTOS)
        preferencias.guardarHistorialJson(codificar(recortado))
    }

    suspend fun limpiar() {
        preferencias.guardarHistorialJson("[]")
        Registro.informacion(ETIQUETA, "Historial local del turno borrado.")
    }

    private fun decodificar(texto: String): List<EventoDto> = runCatching {
        json.decodeFromString(ListSerializer(EventoDto.serializer()), texto)
    }.getOrElse {
        Registro.advertencia(ETIQUETA, "Historial local ilegible; se descarta y se empieza de cero.")
        emptyList()
    }

    private fun codificar(lista: List<EventoDto>): String =
        json.encodeToString(ListSerializer(EventoDto.serializer()), lista)

    @Serializable
    private data class EventoDto(
        val idEvento: String,
        val marcaTiempoMs: Long,
        val codigoOrden: String,
        val huellaChip: String,
        val paso: String,
        val exito: Boolean,
        val detalle: String,
        val simulado: Boolean,
    ) {
        fun aDominio(): EventoHistorial = EventoHistorial(
            idEvento = idEvento,
            marcaTiempoMs = marcaTiempoMs,
            codigoOrden = codigoOrden,
            huellaChip = huellaChip,
            paso = PasoProceso.entries.firstOrNull { it.name == paso } ?: PasoProceso.DETECCION,
            exito = exito,
            detalle = detalle,
            simulado = simulado,
        )
    }

    private fun EventoHistorial.aDto(): EventoDto = EventoDto(
        idEvento = idEvento,
        marcaTiempoMs = marcaTiempoMs,
        codigoOrden = codigoOrden,
        huellaChip = huellaChip,
        paso = paso.name,
        exito = exito,
        detalle = detalle,
        simulado = simulado,
    )

    private companion object {
        const val ETIQUETA = "Historial"
        const val MAXIMO_EVENTOS = 500
    }
}
