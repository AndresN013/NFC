package ec.marathon.nfcstudio.domain.model

/**
 * Niveles de confianza de una verificacion.
 * Portado de `packages/domain/src/trust.ts`.
 *
 * PRINCIPIO RECTOR DEL PROYECTO: identificar NO es autenticar.
 *
 * La app del operario muestra este nivel en la pantalla de Verificacion para
 * que nadie en planta crea que grabar una NTAG 213 produce un jersey
 * "autenticado". Con los proveedores actuales el techo real es
 * IDENTIFIED_ONLY, y la interfaz lo dice con todas las letras.
 */
enum class NivelConfianza {
    /** El chip ejecuto una operacion criptografica valida y verificable en servidor. */
    VERIFIED,

    /** Se reconocio el producto, pero sin prueba criptografica (NDEF simple o QR). */
    IDENTIFIED_ONLY,

    /** El identificador es conocido pero el patron de uso sugiere copia o abuso. */
    SUSPICIOUS,

    /** No hay datos suficientes para emitir un juicio. */
    UNVERIFIABLE,

    /** La unidad o el chip fueron revocados administrativamente. */
    REVOKED,

    /** La unidad existe pero aun no completo la activacion comercial. */
    NOT_ACTIVATED,
    ;

    val titulo: String
        get() = when (this) {
            VERIFIED -> "Jersey verificado"
            IDENTIFIED_ONLY -> "Producto identificado"
            SUSPICIOUS -> "Lectura sospechosa"
            UNVERIFIABLE -> "No se pudo verificar"
            REVOKED -> "Producto revocado"
            NOT_ACTIVATED -> "Producto todavía no activado"
        }

    /** Explicacion para el operario, no para el aficionado. */
    val explicacionPlanta: String
        get() = when (this) {
            VERIFIED ->
                "El chip respondió a una comprobación de seguridad real."
            IDENTIFIED_ONLY ->
                "El sistema reconoce el producto, pero la lectura NO prueba que el " +
                    "emblema sea original. Es lo máximo que alcanza este tipo de chip."
            SUSPICIOUS ->
                "El patrón de lecturas es inusual. Aparte la unidad y avise al supervisor."
            UNVERIFIABLE ->
                "No se pudo leer lo necesario. Repita la lectura sin mover el emblema."
            REVOKED ->
                "Este registro está dado de baja. Aparte la unidad."
            NOT_ACTIVATED ->
                "La unidad existe pero todavía no está activada. Es normal antes del cierre."
        }
}

/** Metodo por el que llego la evidencia. Determina el TECHO de confianza. */
enum class MetodoVerificacion {
    NFC_CRYPTOGRAPHIC,
    NFC_STATIC_URL,
    QR_CODE,
    MANUAL_LOOKUP,
}

/**
 * Techo de confianza por metodo. Ninguna regla posterior puede elevar el
 * resultado por encima de este techo: un QR jamas produce VERIFIED.
 */
val TECHO_CONFIANZA_POR_METODO: Map<MetodoVerificacion, NivelConfianza> = mapOf(
    MetodoVerificacion.NFC_CRYPTOGRAPHIC to NivelConfianza.VERIFIED,
    MetodoVerificacion.NFC_STATIC_URL to NivelConfianza.IDENTIFIED_ONLY,
    MetodoVerificacion.QR_CODE to NivelConfianza.IDENTIFIED_ONLY,
    MetodoVerificacion.MANUAL_LOOKUP to NivelConfianza.IDENTIFIED_ONLY,
)

/** Aplica el techo del metodo: nunca eleva, solo puede degradar. */
fun aplicarTechoDelMetodo(nivel: NivelConfianza, metodo: MetodoVerificacion): NivelConfianza {
    val techo = TECHO_CONFIANZA_POR_METODO.getValue(metodo)
    return if (nivel == NivelConfianza.VERIFIED && techo != NivelConfianza.VERIFIED) techo else nivel
}
