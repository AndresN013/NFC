package ec.marathon.nfcstudio.core

import java.util.UUID

/**
 * Claves de idempotencia.
 *
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Operaciones idempotentes".                     #
 * ###########################################################################
 *
 * Problema real: el operario apoya el emblema, la app reserva el chip en el
 * servidor y justo entonces el telefono pierde el wifi de la nave. El operario
 * pulsa "Reintentar". Sin una clave de idempotencia estable, el segundo intento
 * reservaria un identificador DISTINTO y el primero quedaria huerfano: un chip
 * consumido del inventario que nadie grabo nunca.
 *
 * Regla de esta app: la clave se genera UNA SOLA VEZ por INTENTO LOGICO (no por
 * peticion HTTP) y se reutiliza intacta en todos los reintentos de esa misma
 * operacion. Solo cambia cuando el operario decide empezar de cero con la
 * unidad, porque en ese momento el contenido de la peticion tambien cambia.
 *
 * El servidor (apps/api/src/lib/idempotency.ts) responde 409
 * IDEMPOTENCY_CONFLICT si llega la misma clave con un cuerpo distinto: por eso
 * esta clase inmoviliza la clave junto al alcance que la origino.
 */
@JvmInline
value class ClaveIdempotencia(val valor: String) {
    override fun toString(): String = valor

    companion object {
        /** UUID v4. Suficiente entropia para no colisionar entre puestos. */
        fun nueva(): ClaveIdempotencia = ClaveIdempotencia(UUID.randomUUID().toString())
    }
}

/**
 * Conjunto de claves de un ciclo completo de una unidad.
 *
 * Cada paso del flujo tiene su propia clave porque cada paso es una operacion
 * distinta en el servidor. Se crean todas al empezar la unidad y viven en el
 * estado del ViewModel: mientras el operario siga con la misma unidad, los
 * reintentos reusan exactamente estas.
 */
data class ClavesDeUnidad(
    val reserva: ClaveIdempotencia = ClaveIdempotencia.nueva(),
    val escritura: ClaveIdempotencia = ClaveIdempotencia.nueva(),
    val verificacion: ClaveIdempotencia = ClaveIdempotencia.nueva(),
    val vinculacion: ClaveIdempotencia = ClaveIdempotencia.nueva(),
    val postTermosellado: ClaveIdempotencia = ClaveIdempotencia.nueva(),
    val activacion: ClaveIdempotencia = ClaveIdempotencia.nueva(),
) {
    companion object {
        fun nuevas(): ClavesDeUnidad = ClavesDeUnidad()
    }
}
