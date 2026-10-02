package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.domain.model.PlanBloqueo
import ec.marathon.nfcstudio.domain.model.ReferenciaClave
import ec.marathon.nfcstudio.domain.model.TipoChip

/**
 * Contrato del proveedor de personalizacion NFC.
 *
 * PORT DIRECTO de `packages/nfc-contracts/src/provider.ts`. Los nombres de la
 * interfaz y de sus metodos se conservan en ingles a proposito, para que el
 * contrato sea reconocible como EL MISMO en TypeScript y en Kotlin; todo lo
 * demas del proyecto (parametros, variables, comentarios, textos) esta en
 * espanol. Una revision cruzada de los dos archivos debe poder hacerse linea a
 * linea.
 *
 * El resto de la aplicacion habla SOLO con esta interfaz. Anadir un lector USB
 * o una estacion industrial en el futuro significa escribir una implementacion
 * nueva, sin tocar los ViewModels ni la capa de red.
 *
 * ###########################################################################
 * # REGLA INVIOLABLE                                                        #
 * ###########################################################################
 * Ninguna implementacion recibe, almacena ni devuelve claves maestras. Cuando
 * una operacion necesita material criptografico, recibe una [ReferenciaClave]
 * OPACA (un identificador en el KMS/HSM/SAM) y la operacion criptografica se
 * ejecuta en el servicio que custodia la clave. Buscar en este paquete un
 * parametro de tipo `ByteArray` que represente una clave: no existe, y si
 * apareciera seria un fallo de revision.
 */
interface NfcPersonalizationProvider {

    val capabilities: ProviderCapabilities

    /** Espera a que un chip entre en el campo y devuelve su identidad basica. */
    suspend fun detectTag(): TagDetection

    /** Lee la informacion tecnica permitida del chip ya detectado. */
    suspend fun inspectTag(detection: TagDetection): TagInspection

    /** Comprueba la firma de originalidad del silicio, si el chip la expone. */
    suspend fun validateOriginality(detection: TagDetection): OriginalityResult

    /**
     * Valida LOCALMENTE que el plan es ejecutable sobre este chip (capacidad,
     * tipo, estado de bloqueo) antes de emitir una sola escritura.
     */
    suspend fun preparePersonalization(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): ResultadoPreparacion

    /** Escribe un mensaje NDEF con la URI del plan. */
    suspend fun writeNdef(inspection: TagInspection, plan: PersonalizationPlan): WriteResult

    /**
     * Personalizacion de un chip seguro (claves diversificadas, configuracion
     * SUN). Solo la implementa un proveedor con hardware y SDK reales.
     */
    suspend fun personalizeSecureTag(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): WriteResult

    /** Relee el chip y compara con lo escrito. */
    suspend fun verifyPersonalization(
        inspection: TagInspection,
        plan: PersonalizationPlan,
        write: WriteResult,
    ): VerifyPersonalizationResult

    /** Bloquea las areas permitidas. Operacion IRREVERSIBLE. */
    suspend fun lockAllowedAreas(inspection: TagInspection, lockPlan: PlanBloqueo): WriteResult

    /** Lee el payload que la web del aficionado usaria para verificar. */
    suspend fun readVerificationPayload(detection: TagDetection): VerificationPayload

    /** Comprobacion posterior al termosellado. */
    suspend fun runPostPressCheck(
        detection: TagDetection,
        expectedUri: String,
    ): PostPressResult
}

/**
 * Capacidades declaradas por un proveedor. La aplicacion consulta esto ANTES de
 * ofrecer una operacion, en lugar de intentarla y fallar delante del operario.
 */
data class ProviderCapabilities(
    val id: String,
    val displayName: String,
    val supportedChipTypes: List<TipoChip>,
    /** Puede producir una prueba criptografica verificable en servidor. */
    val canProduceCryptographicProof: Boolean,
    val canVerifyOriginality: Boolean,
    val canLockMemory: Boolean,
    /**
     * `true` cuando el proveedor NO habla con hardware real.
     * La API usa esta marca para degradar el nivel de confianza, y la interfaz
     * para pintar el banner permanente de SIMULACION.
     */
    val isSimulation: Boolean,
    /** Advertencia que la UI muestra sin adornos. null si no hay ninguna. */
    val advertencia: String? = null,
)

data class TagDetection(
    /** UID del chip en hexadecimal. Dato sensible: nunca se expone al aficionado. */
    val uid: String,
    val chipType: TipoChip,
    /** Tecnologias reportadas por la pila NFC, p.ej. ["NfcA", "Ndef"]. */
    val technologies: List<String>,
)

data class TagInspection(
    val uid: String,
    val chipType: TipoChip,
    val technologies: List<String>,
    val userMemoryBytes: Int,
    /** El area NDEF ya fue bloqueada como solo lectura. */
    val readOnly: Boolean,
    /** Ya contiene un mensaje NDEF. */
    val hasNdefMessage: Boolean,
    /** URI actual, si el mensaje existente es un registro URI. */
    val currentUri: String?,
    /** Version del chip segun GET_VERSION, en hexadecimal, si esta disponible. */
    val versionBytes: String?,
) {
    val detection: TagDetection get() = TagDetection(uid, chipType, technologies)
}

/**
 * Resultado de la comprobacion de originalidad del silicio.
 *
 * NXP publica una firma ECC de originalidad en las NTAG 21x (comando READ_SIG).
 * Verificarla comprueba que el SILICIO salio de una fabrica NXP; NO comprueba
 * que el contenido no haya sido copiado a otra etiqueta NXP legitima, ni que el
 * emblema sea el original. Por eso su resultado alimenta el riesgo pero NUNCA
 * produce por si solo VERIFIED.
 */
data class OriginalityResult(
    /** `true` solo si un verificador real valido la firma contra la clave publica de NXP. */
    val verified: Boolean,
    /** `true` cuando el proveedor no puede realizar la comprobacion. */
    val notSupported: Boolean,
    /** `true` si el resultado proviene de una simulacion. */
    val simulated: Boolean,
    val detail: String,
)

/** Plan de personalizacion emitido por el SERVIDOR. El telefono no lo inventa. */
data class PersonalizationPlan(
    /** Identificador del trabajo, emitido por el servidor. Idempotencia. */
    val jobId: String,
    /** URI a grabar en el registro NDEF. */
    val uri: String,
    /** Referencias de clave OPACAS para chips seguros. Vacio para NTAG 21x. */
    val keyReferences: List<ReferenciaClave>,
    /** Areas que deben bloquearse tras verificar la escritura. */
    val lockPlan: PlanBloqueo,
)

data class ResultadoPreparacion(
    val ok: Boolean,
    val error: InfoErrorNfc? = null,
)

data class WriteResult(
    val success: Boolean,
    val bytesWritten: Int,
    /** Bytes exactos que se enviaron al chip, para poder comparar en la relectura. */
    val writtenPayloadHex: String,
    val error: InfoErrorNfc? = null,
)

data class VerificationPayload(
    /** Token leido del chip. */
    val token: String?,
    /** Mensaje autenticado (SUN/CMAC) si el chip lo produce. null en NTAG 21x. */
    val authenticatedMessage: String?,
    /** Contador de lecturas si el chip lo expone. */
    val readCounter: Int?,
    /**
     * `true` si el payload provino de un proveedor simulado.
     * La API degrada el nivel de confianza cuando esta marca esta activa.
     */
    val simulated: Boolean,
    /** URI completa leida, para poder mostrarla en la pantalla de Verificacion. */
    val uri: String? = null,
)

data class VerifyPersonalizationResult(
    /** La relectura coincide con lo que se escribio. */
    val matches: Boolean,
    val readBackUri: String?,
    val detail: String,
)

data class PostPressResult(
    /** El chip sigue respondiendo tras el termosellado. */
    val readable: Boolean,
    /** El contenido sigue siendo el esperado. */
    val contentIntact: Boolean,
    /**
     * Intensidad de senal relativa 0..100 si la plataforma la expone.
     *
     * En Android es SIEMPRE null: la API de NFC no expone RSSI ni ninguna
     * medida de calidad de acoplamiento. Se deja el campo por compatibilidad
     * con el contrato y con futuros lectores industriales que si la dan.
     */
    val signalStrength: Int?,
    val detail: String,
)

/** Codigos de error de NFC. Espejo exacto de NFC_ERROR_CODES en TypeScript. */
enum class CodigoErrorNfc {
    TAG_LOST,
    TAG_READ_ONLY,
    TAG_NOT_NDEF,
    TAG_TYPE_UNSUPPORTED,
    INSUFFICIENT_MEMORY,
    WRITE_FAILED,
    VERIFY_MISMATCH,
    AUTH_FAILED,
    TRANSPORT_ERROR,
    NOT_IMPLEMENTED,
    OPERATION_NOT_PERMITTED,
}

data class InfoErrorNfc(
    val code: CodigoErrorNfc,
    /** Mensaje tecnico para el registro de auditoria. Sin secretos. */
    val detail: String,
    /** Mensaje comprensible para el operario en planta. */
    val operatorMessage: String,
    /** El operario puede reintentar la misma operacion sin riesgo. */
    val retryable: Boolean,
)

class NfcOperationException(val info: InfoErrorNfc) : Exception(info.detail)

/**
 * Mensajes en espanol, redactados para alguien en planta, no para un ingeniero.
 *
 * Son los mismos de OPERATOR_MESSAGES en
 * `packages/nfc-contracts/src/provider.ts`, con las tildes que el archivo
 * TypeScript omite por restricciones de codificacion de aquel entorno.
 */
val MENSAJES_OPERARIO_NFC: Map<CodigoErrorNfc, String> = mapOf(
    CodigoErrorNfc.TAG_LOST to
        "Se perdió el contacto. Mantenga el emblema apoyado sin moverlo hasta que suene.",
    CodigoErrorNfc.TAG_READ_ONLY to
        "Este chip ya está bloqueado y no admite escritura. Aparte la unidad.",
    CodigoErrorNfc.TAG_NOT_NDEF to
        "El chip no tiene el formato esperado. Aparte la unidad y avise al supervisor.",
    CodigoErrorNfc.TAG_TYPE_UNSUPPORTED to
        "Este tipo de chip no corresponde a esta orden. Verifique el lote.",
    CodigoErrorNfc.INSUFFICIENT_MEMORY to
        "El chip no tiene memoria suficiente. Verifique el modelo del lote.",
    CodigoErrorNfc.WRITE_FAILED to
        "No se pudo grabar. Retire el teléfono, vuelva a acercarlo e intente de nuevo.",
    CodigoErrorNfc.VERIFY_MISMATCH to
        "La comprobación posterior no coincide. La unidad pasa a cuarentena automáticamente.",
    CodigoErrorNfc.AUTH_FAILED to
        "El chip rechazó la operación de seguridad. Aparte la unidad.",
    CodigoErrorNfc.TRANSPORT_ERROR to
        "Error de comunicación con el chip. Intente nuevamente.",
    CodigoErrorNfc.NOT_IMPLEMENTED to
        "Esta operación no está disponible en este equipo.",
    CodigoErrorNfc.OPERATION_NOT_PERMITTED to
        "No tiene autorización para esta operación.",
)

fun infoErrorNfc(
    code: CodigoErrorNfc,
    detail: String,
    retryable: Boolean = false,
): InfoErrorNfc = InfoErrorNfc(
    code = code,
    detail = detail,
    operatorMessage = MENSAJES_OPERARIO_NFC.getValue(code),
    retryable = retryable,
)

fun errorNfc(
    code: CodigoErrorNfc,
    detail: String,
    retryable: Boolean = false,
): NfcOperationException = NfcOperationException(infoErrorNfc(code, detail, retryable))

/** Identificadores de proveedor admitidos. Espejo de PROVIDER_IDS. */
object IdsProveedor {
    const val SIMULADO = "mock"
    const val NTAG21X = "ntag21x-ndef"
    const val NTAG424 = "ntag424dna"
}

/** Descripcion corta de una excepcion, sin volcar la traza al operario. */
internal fun describirError(error: Throwable): String =
    error.message ?: error.javaClass.simpleName
