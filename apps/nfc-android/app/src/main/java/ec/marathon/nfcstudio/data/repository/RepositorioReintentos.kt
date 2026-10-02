package ec.marathon.nfcstudio.data.repository

import ec.marathon.nfcstudio.core.ClaveIdempotencia
import ec.marathon.nfcstudio.core.CodigoError
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.core.RedactorDeSecretos
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.domain.model.PasoProceso
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * Cola de operaciones de servidor que fallaron y pueden reintentarse.
 *
 * ###########################################################################
 * # Por que esto existe                                                     #
 * ###########################################################################
 *
 * En la nave hay zonas sin cobertura. El caso tipico: el operario graba el chip
 * correctamente (el chip YA tiene el contenido) y la confirmacion al servidor no
 * sale. Si se descartara ese aviso, el servidor creeria que la escritura fallo y
 * el chip quedaria en un estado que no refleja la realidad fisica.
 *
 * Esta cola guarda el aviso pendiente CON SU CLAVE DE IDEMPOTENCIA ORIGINAL. Al
 * reintentar, el servidor reconoce la clave y responde con el resultado de la
 * primera ejecucion en lugar de ejecutar el efecto dos veces.
 *
 * Lo que la cola NO guarda: nada que no pueda estar en claro. El payload escrito
 * no se almacena, solo su hash, que es lo que el endpoint necesita.
 */
class RepositorioReintentos(private val preferencias: PreferenciasApp) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    val pendientes: Flow<List<OperacionPendiente>> = preferencias.pendientesJson.map { texto ->
        decodificar(texto).map { it.aDominio() }.sortedBy { it.creadaEnMs }
    }

    suspend fun encolar(operacion: OperacionPendiente) {
        val actuales = decodificar(preferencias.pendientesJson.first()).toMutableList()
        // Si ya hay una pendiente con la misma clave, se actualiza en lugar de
        // duplicar: dos entradas con la misma clave confundirian al operario.
        val indice = actuales.indexOfFirst { it.claveIdempotencia == operacion.claveIdempotencia.valor }
        val dto = operacion.aDto()
        if (indice >= 0) actuales[indice] = dto else actuales.add(dto)
        preferencias.guardarPendientesJson(codificar(actuales))
        Registro.advertencia(
            ETIQUETA,
            "Operación ${operacion.paso.name} encolada para reintento.",
        )
    }

    suspend fun resolver(idOperacion: String) {
        val actuales = decodificar(preferencias.pendientesJson.first())
            .filterNot { it.idOperacion == idOperacion }
        preferencias.guardarPendientesJson(codificar(actuales))
    }

    suspend fun anotarIntentoFallido(idOperacion: String, error: ErrorApp) {
        val actuales = decodificar(preferencias.pendientesJson.first()).map { dto ->
            if (dto.idOperacion == idOperacion) {
                dto.copy(
                    intentos = dto.intentos + 1,
                    ultimoCodigoError = error.codigo.name,
                    ultimoDetalle = RedactorDeSecretos.redactar(error.detalleTecnico).take(200),
                )
            } else {
                dto
            }
        }
        preferencias.guardarPendientesJson(codificar(actuales))
    }

    suspend fun descartar(idOperacion: String) {
        resolver(idOperacion)
        Registro.advertencia(ETIQUETA, "El operario descartó una operación pendiente.")
    }

    suspend fun limpiar() {
        preferencias.guardarPendientesJson("[]")
    }

    /**
     * Reintenta una operacion pendiente ejecutando [accion], que debe usar la
     * MISMA clave de idempotencia que trae la operacion.
     */
    suspend fun reintentar(
        operacion: OperacionPendiente,
        accion: suspend (OperacionPendiente) -> Resultado<Unit>,
    ): Resultado<Unit> {
        val resultado = accion(operacion)
        when (resultado) {
            is Resultado.Exito -> resolver(operacion.idOperacion)
            is Resultado.Fallo -> anotarIntentoFallido(operacion.idOperacion, resultado.error)
        }
        return resultado
    }

    private fun decodificar(texto: String): List<OperacionDto> = runCatching {
        json.decodeFromString(ListSerializer(OperacionDto.serializer()), texto)
    }.getOrElse {
        Registro.advertencia(ETIQUETA, "Cola de pendientes ilegible; se descarta.")
        emptyList()
    }

    private fun codificar(lista: List<OperacionDto>): String =
        json.encodeToString(ListSerializer(OperacionDto.serializer()), lista)

    @Serializable
    private data class OperacionDto(
        val idOperacion: String,
        val claveIdempotencia: String,
        val paso: String,
        val creadaEnMs: Long,
        val codigoOrden: String,
        val idTrabajo: String? = null,
        val idUnidad: String? = null,
        val hashPayload: String? = null,
        val uriReleida: String? = null,
        val coincide: Boolean? = null,
        val intentos: Int = 0,
        val ultimoCodigoError: String? = null,
        val ultimoDetalle: String? = null,
        val simulado: Boolean = false,
    ) {
        fun aDominio(): OperacionPendiente = OperacionPendiente(
            idOperacion = idOperacion,
            claveIdempotencia = ClaveIdempotencia(claveIdempotencia),
            paso = PasoProceso.entries.firstOrNull { it.name == paso } ?: PasoProceso.ESCRITURA,
            creadaEnMs = creadaEnMs,
            codigoOrden = codigoOrden,
            idTrabajo = idTrabajo,
            idUnidad = idUnidad,
            hashPayload = hashPayload,
            uriReleida = uriReleida,
            coincide = coincide,
            intentos = intentos,
            ultimoCodigoError = ultimoCodigoError?.let { nombre ->
                CodigoError.entries.firstOrNull { it.name == nombre }
            },
            ultimoDetalle = ultimoDetalle,
            simulado = simulado,
        )
    }

    private fun OperacionPendiente.aDto(): OperacionDto = OperacionDto(
        idOperacion = idOperacion,
        claveIdempotencia = claveIdempotencia.valor,
        paso = paso.name,
        creadaEnMs = creadaEnMs,
        codigoOrden = codigoOrden,
        idTrabajo = idTrabajo,
        idUnidad = idUnidad,
        hashPayload = hashPayload,
        uriReleida = uriReleida,
        coincide = coincide,
        intentos = intentos,
        ultimoCodigoError = ultimoCodigoError?.name,
        ultimoDetalle = ultimoDetalle,
        simulado = simulado,
    )

    private companion object {
        const val ETIQUETA = "Reintentos"
    }
}

/** Operacion de servidor pendiente de confirmar. */
data class OperacionPendiente(
    val idOperacion: String = UUID.randomUUID().toString(),
    /** LA MISMA clave del primer intento. Es el nucleo de la idempotencia. */
    val claveIdempotencia: ClaveIdempotencia,
    val paso: PasoProceso,
    val creadaEnMs: Long = System.currentTimeMillis(),
    val codigoOrden: String,
    val idTrabajo: String? = null,
    val idUnidad: String? = null,
    val hashPayload: String? = null,
    val uriReleida: String? = null,
    val coincide: Boolean? = null,
    val intentos: Int = 0,
    val ultimoCodigoError: CodigoError? = null,
    val ultimoDetalle: String? = null,
    val simulado: Boolean = false,
) {
    /** Texto que se muestra al operario en la pantalla de errores. */
    val descripcionOperario: String
        get() = when (paso) {
            PasoProceso.ESCRITURA ->
                "Falta avisar al sistema de que el emblema quedó grabado."
            PasoProceso.RELECTURA ->
                "Falta avisar al sistema del resultado de la comprobación."
            PasoProceso.VINCULACION ->
                "Falta registrar la unión del emblema con el jersey."
            PasoProceso.POST_TERMOSELLADO ->
                "Falta enviar el resultado de la prueba posterior a la prensa."
            PasoProceso.ACTIVACION ->
                "Falta activar la unidad."
            else ->
                "Falta completar el paso: ${paso.titulo}."
        }
}
