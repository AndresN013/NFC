package ec.marathon.nfcstudio.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Objetos de transporte de la API de produccion.
 *
 * Son un espejo literal del contrato HTTP y NO se usan en la interfaz: para eso
 * estan los modelos de `domain/model`. La conversion vive en los repositorios.
 * Mezclarlos haria que renombrar un campo del backend rompiera una pantalla.
 *
 * Todos llevan valores por defecto donde el contrato lo permite, para que anadir
 * un campo en el servidor no tumbe la app instalada en los telefonos de planta:
 * una actualizacion de APK en una nave con 40 puestos no es inmediata.
 */

// --- Autenticacion ----------------------------------------------------------

@Serializable
data class SolicitudLogin(
    val email: String,
    /**
     * SEGURIDAD: la contrasena solo existe en memoria durante esta llamada.
     * No se guarda en DataStore, ni en el almacen cifrado, ni se rellena
     * automaticamente. El campo de la UI la mantiene como estado transitorio y
     * se borra al salir de la pantalla.
     */
    val password: String,
    val deviceId: String,
)

@Serializable
data class RespuestaLogin(
    val token: String,
    /** ISO-8601. Los tokens son de CORTA DURACION por diseno. */
    val expiresAt: String,
    val user: UsuarioDto,
)

@Serializable
data class UsuarioDto(
    val id: String,
    val displayName: String,
    /** Opcional: si el servidor lo envia, la app puede ocultar operaciones. */
    val role: String? = null,
    /**
     * Indica si ESTE teléfono está autorizado para programar.
     * Si el servidor no lo envia, la app asume que NO lo esta: fallar cerrado.
     */
    val deviceAuthorized: Boolean? = null,
    val deviceLabel: String? = null,
)

// --- Ordenes ----------------------------------------------------------------

@Serializable
data class OrdenDto(
    val id: String,
    val code: String,
    val state: String,
    val plannedUnits: Int = 0,
    val remainingUnits: Int = 0,
    val clubName: String = "",
    val seasonName: String = "",
    val modelName: String = "",
    val batchCode: String = "",
    /** Tipo de chip que declara el lote. Permite avisar antes de escribir. */
    val expectedChipType: String? = null,
    val skuCode: String? = null,
)

// --- Inspeccion de chip -----------------------------------------------------

@Serializable
data class SolicitudInspeccion(
    val uid: String,
    val chipType: String,
)

@Serializable
data class RespuestaInspeccion(
    val known: Boolean,
    val state: String? = null,
    val message: String = "",
)

// --- Reserva de trabajo -----------------------------------------------------

@Serializable
data class SolicitudReserva(
    val orderId: String,
    val uid: String,
    val chipType: String,
)

@Serializable
data class RespuestaReserva(
    val jobId: String,
    val chipId: String,
    val targetUri: String,
    val providerId: String,
    val lockPlan: PlanBloqueoDto,
    /**
     * Referencias OPACAS a claves. Vacio para NTAG 21x.
     * Aqui NO viene material criptografico: solo punteros al custodio.
     */
    val keyReferences: List<ReferenciaClaveDto> = emptyList(),
)

@Serializable
data class PlanBloqueoDto(
    val lockNdefReadOnly: Boolean = false,
    val lockConfiguration: Boolean = false,
)

@Serializable
data class ReferenciaClaveDto(
    val reference: String,
    val custodian: String,
    val version: Int = 1,
)

// --- Resultado de escritura y verificacion ----------------------------------

@Serializable
data class SolicitudEscritura(
    val success: Boolean,
    /**
     * Hash del payload escrito, NO el payload.
     *
     * Enviar el contenido literal significaria que el tagToken viaja de vuelta
     * al servidor por segunda vez y aparece en registros de acceso. El servidor
     * solo necesita comprobar que coincide con lo que ordeno escribir.
     */
    val writtenPayloadHash: String,
    val errorCode: String? = null,
)

@Serializable
data class SolicitudVerificacion(
    val matches: Boolean,
    val readBackUri: String? = null,
)

/** Respuesta generica de los endpoints que solo confirman el estado. */
@Serializable
data class RespuestaEstadoChip(
    val state: String? = null,
    val jobId: String? = null,
    val message: String? = null,
)

// --- Vinculacion con el jersey ---------------------------------------------

@Serializable
data class SolicitudVinculacion(
    val jobId: String,
    val skuCode: String,
    val emblemCode: String,
    val jerseyBarcode: String,
)

@Serializable
data class RespuestaVinculacion(
    val unitId: String,
    val publicRef: String,
    val state: String? = null,
)

// --- Control posterior al termosellado -------------------------------------

@Serializable
data class SolicitudPostTermosellado(
    val passed: Boolean,
    val readable: Boolean,
    val contentIntact: Boolean,
    val temperatureC: Double? = null,
    val pressureBar: Double? = null,
    val durationSec: Int? = null,
    /** Marca honesta: si la lectura la produjo el simulador, se declara. */
    val simulated: Boolean,
)

// --- Cuarentena -------------------------------------------------------------

@Serializable
data class SolicitudCuarentena(
    val reason: String,
)

// --- Errores ----------------------------------------------------------------

/** Envoltorio de error de la API: `{error:{code,message,retryable?}}`. */
@Serializable
data class SobreError(
    val error: CuerpoError,
)

@Serializable
data class CuerpoError(
    val code: String = "INTERNAL",
    val message: String = "",
    val retryable: Boolean? = null,
    @SerialName("requestId")
    val idPeticion: String? = null,
)
