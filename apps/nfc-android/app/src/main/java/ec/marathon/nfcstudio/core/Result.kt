package ec.marathon.nfcstudio.core

/**
 * Resultado explicito de una operacion que puede fallar.
 *
 * Se usa en lugar de excepciones en las fronteras (red, NFC, almacenamiento)
 * porque en planta el fallo NO es excepcional: es el caso frecuente. Un chip
 * que se separa del telefono a mitad de escritura no es un error de programa,
 * es martes por la manana. Modelarlo como valor obliga a que cada punto de la
 * interfaz decida que mostrar al operario.
 */
sealed interface Resultado<out T> {

    data class Exito<out T>(val valor: T) : Resultado<T>

    data class Fallo(val error: ErrorApp) : Resultado<Nothing>

    val esExito: Boolean get() = this is Exito

    fun valorONulo(): T? = when (this) {
        is Exito -> valor
        is Fallo -> null
    }

    fun errorONulo(): ErrorApp? = when (this) {
        is Exito -> null
        is Fallo -> error
    }
}

inline fun <T, R> Resultado<T>.mapear(transformacion: (T) -> R): Resultado<R> = when (this) {
    is Resultado.Exito -> Resultado.Exito(transformacion(valor))
    is Resultado.Fallo -> this
}

inline fun <T, R> Resultado<T>.encadenar(siguiente: (T) -> Resultado<R>): Resultado<R> =
    when (this) {
        is Resultado.Exito -> siguiente(valor)
        is Resultado.Fallo -> this
    }

inline fun <T> Resultado<T>.alFallar(accion: (ErrorApp) -> Unit): Resultado<T> {
    if (this is Resultado.Fallo) accion(error)
    return this
}

/**
 * Error de aplicacion ya traducido al lenguaje del operario.
 *
 * Distingue dos textos a proposito:
 *  - [mensajeOperario]: lo que se muestra en pantalla. Sin jerga, accionable.
 *  - [detalleTecnico]: lo que va al registro de auditoria. Nunca a la pantalla,
 *    nunca con secretos (pasa por el redactor de [Registro] antes de emitirse).
 */
data class ErrorApp(
    val codigo: CodigoError,
    val mensajeOperario: String,
    val detalleTecnico: String,
    val reintentable: Boolean,
) {
    companion object {
        fun de(codigo: CodigoError, detalleTecnico: String, reintentable: Boolean? = null) =
            ErrorApp(
                codigo = codigo,
                mensajeOperario = MENSAJES_OPERARIO[codigo] ?: MENSAJES_OPERARIO.getValue(CodigoError.INTERNO),
                detalleTecnico = detalleTecnico,
                reintentable = reintentable ?: codigo.reintentablePorDefecto,
            )
    }
}

/**
 * Codigos estables. Los siete primeros reflejan uno a uno los de
 * `apps/api/src/lib/errors.ts`; el resto son condiciones que solo existen en el
 * telefono (sin cobertura, respuesta ilegible, NFC apagado).
 */
enum class CodigoError(val reintentablePorDefecto: Boolean) {
    // --- Espejo de la API --------------------------------------------------
    SOLICITUD_INVALIDA(false),
    NO_AUTORIZADO(false),
    PROHIBIDO(false),
    NO_ENCONTRADO(false),
    CONFLICTO(false),
    ESTADO_INVALIDO(false),
    LIMITE_DE_PETICIONES(true),
    CONFLICTO_IDEMPOTENCIA(false),
    NO_IMPLEMENTADO(false),
    INTERNO(true),

    // --- Solo del cliente --------------------------------------------------
    SIN_RED(true),
    TIEMPO_AGOTADO(true),
    RESPUESTA_ILEGIBLE(false),
    SESION_EXPIRADA(false),
    NFC_NO_DISPONIBLE(false),
    NFC_APAGADO(true),
    TELEFONO_NO_AUTORIZADO(false),
    ERROR_NFC(true),
    ;

    companion object {
        /** Traduce el codigo textual que envia la API al enum local. */
        fun desdeApi(codigo: String?): CodigoError = when (codigo?.uppercase()) {
            "BAD_REQUEST" -> SOLICITUD_INVALIDA
            "UNAUTHORIZED" -> NO_AUTORIZADO
            "FORBIDDEN" -> PROHIBIDO
            "NOT_FOUND" -> NO_ENCONTRADO
            "CONFLICT" -> CONFLICTO
            "INVALID_STATE" -> ESTADO_INVALIDO
            "RATE_LIMITED" -> LIMITE_DE_PETICIONES
            "IDEMPOTENCY_CONFLICT" -> CONFLICTO_IDEMPOTENCIA
            "NOT_IMPLEMENTED" -> NO_IMPLEMENTADO
            "INTERNAL" -> INTERNO
            else -> INTERNO
        }
    }
}

/**
 * Traduccion de cada codigo a una frase que un operario de planta entiende sin
 * formacion tecnica. Se evita deliberadamente: "error", "excepcion", "servidor",
 * "token", "HTTP" y cualquier numero de codigo.
 */
val MENSAJES_OPERARIO: Map<CodigoError, String> = mapOf(
    CodigoError.SOLICITUD_INVALIDA to
        "Los datos enviados no son válidos. Revise la orden y vuelva a intentarlo.",
    CodigoError.NO_AUTORIZADO to
        "Su sesión ya no es válida. Vuelva a ingresar con su usuario y contraseña.",
    CodigoError.PROHIBIDO to
        "Su usuario no tiene permiso para esta operación. Avise al supervisor.",
    CodigoError.NO_ENCONTRADO to
        "No encontramos este registro. Puede que la orden se haya cerrado. Actualice la lista.",
    CodigoError.CONFLICTO to
        "Otro puesto ya tomó esta unidad. Aparte el emblema y tome el siguiente.",
    CodigoError.ESTADO_INVALIDO to
        "Esta unidad no está en el punto del proceso que corresponde a esta pantalla. Avise al supervisor.",
    CodigoError.LIMITE_DE_PETICIONES to
        "Vamos demasiado rápido. Espere unos segundos y repita la operación.",
    CodigoError.CONFLICTO_IDEMPOTENCIA to
        "Este intento ya se registró con datos diferentes. Comience la unidad de nuevo.",
    CodigoError.NO_IMPLEMENTADO to
        "Esta operación todavía no está disponible en este equipo.",
    CodigoError.INTERNO to
        "Tuvimos un problema al guardar. Espere un momento y vuelva a intentarlo.",
    CodigoError.SIN_RED to
        "El teléfono no tiene conexión. Acérquese al punto de red y reintente; no perderá el avance.",
    CodigoError.TIEMPO_AGOTADO to
        "La respuesta está tardando demasiado. Reintente sin mover el emblema.",
    CodigoError.RESPUESTA_ILEGIBLE to
        "Recibimos una respuesta que no entendemos. Avise al supervisor.",
    CodigoError.SESION_EXPIRADA to
        "Su turno de sesión terminó por seguridad. Vuelva a ingresar.",
    CodigoError.NFC_NO_DISPONIBLE to
        "Este teléfono no tiene lector NFC. Solo puede usarse en modo simulación.",
    CodigoError.NFC_APAGADO to
        "El NFC está apagado. Actívelo en los ajustes del teléfono y vuelva aquí.",
    CodigoError.TELEFONO_NO_AUTORIZADO to
        "Este teléfono no está habilitado para programar. Entréguelo al supervisor.",
    CodigoError.ERROR_NFC to
        "Se perdió el contacto. Mantenga el emblema apoyado sin moverlo hasta que suene.",
)
