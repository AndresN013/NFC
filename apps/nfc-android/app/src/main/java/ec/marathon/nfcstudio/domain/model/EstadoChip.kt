package ec.marathon.nfcstudio.domain.model

/**
 * Maquina de estados del ciclo de vida fisico del chip.
 *
 * PORTADO FIELMENTE de `packages/domain/src/states.ts`. Si ese archivo cambia,
 * este debe cambiar con el: la API rechaza con 409 cualquier salto no
 * declarado, asi que una divergencia aqui se manifiesta como un error
 * incomprensible para el operario en mitad de la linea.
 *
 * El cliente valida la transicion ANTES de llamar al servidor no porque confie
 * en el cliente (no se confia), sino para poder decir "esta unidad no esta en
 * el punto del proceso que corresponde a esta pantalla" sin gastar una llamada
 * de red ni ocupar el puesto de trabajo.
 */
enum class EstadoChip {
    /** El chip llego a la planta dentro de un lote del proveedor. */
    RECEIVED,

    /** Se inspecciono y el tipo declarado coincide con el detectado. */
    VALIDATED,

    /** Asignado a una orden de produccion; ningun otro puesto puede tomarlo. */
    RESERVED,

    /** Operacion de escritura en curso (estado transitorio, con expiracion). */
    PERSONALIZING,

    /** La escritura reporto exito. Todavia sin relectura de confirmacion. */
    PROGRAMMED,

    /** Relectura posterior a la escritura correcta. */
    VERIFIED,

    /** Vinculado a un emblema y a una unidad de jersey concreta. */
    LINKED,

    /** Listo para pasar por la prensa de termosellado. */
    READY_FOR_HEAT_PRESS,

    /** Supero la lectura posterior al calor. */
    POST_PRESS_PASSED,

    /** Activado comercialmente: la web del aficionado ya puede verificarlo. */
    ACTIVATED,

    /** Retenido por una anomalia. Requiere decision humana. */
    QUARANTINED,

    /** Dado de baja definitivamente por seguridad o devolucion. */
    REVOKED,

    /** Destruido fisicamente y registrado como tal. */
    DESTROYED,
    ;

    /** Texto para el operario. No usa el nombre tecnico del estado. */
    val etiquetaOperario: String
        get() = when (this) {
            RECEIVED -> "Recibido en planta"
            VALIDATED -> "Revisado"
            RESERVED -> "Apartado para esta orden"
            PERSONALIZING -> "Grabando"
            PROGRAMMED -> "Grabado"
            VERIFIED -> "Comprobado"
            LINKED -> "Unido al jersey"
            READY_FOR_HEAT_PRESS -> "Listo para la prensa"
            POST_PRESS_PASSED -> "Aprobado tras la prensa"
            ACTIVATED -> "Activado"
            QUARANTINED -> "En cuarentena"
            REVOKED -> "Dado de baja"
            DESTROYED -> "Destruido"
        }

    companion object {
        /** Devuelve null en lugar de lanzar: la API podria anadir estados. */
        fun desdeApi(valor: String?): EstadoChip? =
            entries.firstOrNull { it.name.equals(valor, ignoreCase = true) }
    }
}

/**
 * Transiciones permitidas. Cualquier par ausente es un error.
 *
 * Copia exacta de CHIP_TRANSITIONS en `packages/domain/src/states.ts`,
 * incluidas las dos sutilezas que importan:
 *  - PERSONALIZING -> PERSONALIZING: reintento seguro de la escritura con la
 *    MISMA clave de idempotencia tras un fallo de comunicacion NFC.
 *  - QUARANTINED es alcanzable desde casi cualquier estado operativo, porque
 *    una anomalia puede detectarse en cualquier momento.
 */
val TRANSICIONES_CHIP: Map<EstadoChip, List<EstadoChip>> = mapOf(
    EstadoChip.RECEIVED to listOf(
        EstadoChip.VALIDATED, EstadoChip.QUARANTINED, EstadoChip.DESTROYED,
    ),
    EstadoChip.VALIDATED to listOf(
        EstadoChip.RESERVED, EstadoChip.QUARANTINED, EstadoChip.DESTROYED,
    ),
    EstadoChip.RESERVED to listOf(
        EstadoChip.PERSONALIZING, EstadoChip.VALIDATED, EstadoChip.QUARANTINED,
    ),
    EstadoChip.PERSONALIZING to listOf(
        EstadoChip.PERSONALIZING, EstadoChip.PROGRAMMED, EstadoChip.RESERVED, EstadoChip.QUARANTINED,
    ),
    EstadoChip.PROGRAMMED to listOf(
        EstadoChip.VERIFIED, EstadoChip.PERSONALIZING, EstadoChip.QUARANTINED,
    ),
    EstadoChip.VERIFIED to listOf(
        EstadoChip.LINKED, EstadoChip.QUARANTINED,
    ),
    EstadoChip.LINKED to listOf(
        EstadoChip.READY_FOR_HEAT_PRESS, EstadoChip.QUARANTINED,
    ),
    EstadoChip.READY_FOR_HEAT_PRESS to listOf(
        EstadoChip.POST_PRESS_PASSED, EstadoChip.QUARANTINED,
    ),
    EstadoChip.POST_PRESS_PASSED to listOf(
        EstadoChip.ACTIVATED, EstadoChip.QUARANTINED,
    ),
    EstadoChip.ACTIVATED to listOf(
        EstadoChip.REVOKED, EstadoChip.QUARANTINED,
    ),
    EstadoChip.QUARANTINED to listOf(
        EstadoChip.VALIDATED,
        EstadoChip.RESERVED,
        EstadoChip.LINKED,
        EstadoChip.ACTIVATED,
        EstadoChip.REVOKED,
        EstadoChip.DESTROYED,
    ),
    EstadoChip.REVOKED to listOf(EstadoChip.DESTROYED),
    EstadoChip.DESTROYED to emptyList(),
)

fun puedeTransicionarChip(desde: EstadoChip, hacia: EstadoChip): Boolean =
    TRANSICIONES_CHIP[desde].orEmpty().contains(hacia)

/** Error de transicion invalida, equivalente a InvalidStateTransitionError. */
class TransicionInvalidaException(
    val entidad: String,
    val desde: EstadoChip,
    val hacia: EstadoChip,
) : IllegalStateException("Transición inválida de $entidad: $desde -> $hacia")

fun exigirTransicionChip(desde: EstadoChip, hacia: EstadoChip) {
    if (!puedeTransicionarChip(desde, hacia)) {
        throw TransicionInvalidaException("NfcChip", desde, hacia)
    }
}

/** Estados en los que el chip todavia no debe producir lecturas de aficionados. */
val ESTADOS_PREVIOS_A_VENTA: List<EstadoChip> = listOf(
    EstadoChip.RECEIVED,
    EstadoChip.VALIDATED,
    EstadoChip.RESERVED,
    EstadoChip.PERSONALIZING,
    EstadoChip.PROGRAMMED,
    EstadoChip.VERIFIED,
    EstadoChip.LINKED,
    EstadoChip.READY_FOR_HEAT_PRESS,
    EstadoChip.POST_PRESS_PASSED,
)

/** Estados terminales: ninguna operacion de planta puede sacarlos de ahi. */
val ESTADOS_TERMINALES: List<EstadoChip> = listOf(EstadoChip.DESTROYED)
