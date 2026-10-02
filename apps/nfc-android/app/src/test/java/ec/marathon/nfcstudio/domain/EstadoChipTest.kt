package ec.marathon.nfcstudio.domain

import ec.marathon.nfcstudio.domain.model.ESTADOS_PREVIOS_A_VENTA
import ec.marathon.nfcstudio.domain.model.EstadoChip
import ec.marathon.nfcstudio.domain.model.TRANSICIONES_CHIP
import ec.marathon.nfcstudio.domain.model.TransicionInvalidaException
import ec.marathon.nfcstudio.domain.model.exigirTransicionChip
import ec.marathon.nfcstudio.domain.model.puedeTransicionarChip
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pruebas de la máquina de estados del chip.
 *
 * Portada de `packages/domain/src/states.ts`. El servidor rechaza con 409
 * cualquier salto no declarado, así que una divergencia entre esta tabla y la del
 * servidor se manifiesta como un error incomprensible en mitad de la línea de
 * producción. Estas pruebas fijan la tabla.
 */
class EstadoChipTest {

    @Test
    fun `los trece estados del contrato estan declarados`() {
        assertEquals(13, EstadoChip.entries.size)
        val esperados = listOf(
            "RECEIVED", "VALIDATED", "RESERVED", "PERSONALIZING", "PROGRAMMED",
            "VERIFIED", "LINKED", "READY_FOR_HEAT_PRESS", "POST_PRESS_PASSED",
            "ACTIVATED", "QUARANTINED", "REVOKED", "DESTROYED",
        )
        assertEquals(esperados, EstadoChip.entries.map { it.name })
    }

    @Test
    fun `todos los estados tienen una entrada en la tabla de transiciones`() {
        // Un estado sin entrada devolvería lista vacía y parecería terminal, lo
        // que bloquearía la producción de forma silenciosa.
        for (estado in EstadoChip.entries) {
            assertTrue(
                TRANSICIONES_CHIP.containsKey(estado),
                "falta la entrada de $estado en TRANSICIONES_CHIP",
            )
        }
    }

    // --- El camino feliz completo -------------------------------------------

    @Test
    fun `el recorrido completo de produccion es valido paso a paso`() {
        val recorrido = listOf(
            EstadoChip.RECEIVED,
            EstadoChip.VALIDATED,
            EstadoChip.RESERVED,
            EstadoChip.PERSONALIZING,
            EstadoChip.PROGRAMMED,
            EstadoChip.VERIFIED,
            EstadoChip.LINKED,
            EstadoChip.READY_FOR_HEAT_PRESS,
            EstadoChip.POST_PRESS_PASSED,
            EstadoChip.ACTIVATED,
        )

        for (indice in 0 until recorrido.size - 1) {
            val desde = recorrido[indice]
            val hacia = recorrido[indice + 1]
            assertTrue(
                puedeTransicionarChip(desde, hacia),
                "el camino de producción debería permitir $desde -> $hacia",
            )
        }
    }

    // --- Saltos prohibidos --------------------------------------------------

    @Test
    fun `no se puede saltar la relectura de comprobacion`() {
        // PROGRAMMED -> LINKED se salta VERIFIED, es decir, se salta la
        // comprobación posterior a la escritura. Es EL salto que nunca debe
        // permitirse: sin relectura no hay garantía de que el chip contenga nada.
        assertFalse(puedeTransicionarChip(EstadoChip.PROGRAMMED, EstadoChip.LINKED))
    }

    @Test
    fun `no se puede activar sin pasar el control posterior a la prensa`() {
        assertFalse(puedeTransicionarChip(EstadoChip.LINKED, EstadoChip.ACTIVATED))
        assertFalse(puedeTransicionarChip(EstadoChip.READY_FOR_HEAT_PRESS, EstadoChip.ACTIVATED))
        assertFalse(puedeTransicionarChip(EstadoChip.VERIFIED, EstadoChip.ACTIVATED))
        assertTrue(puedeTransicionarChip(EstadoChip.POST_PRESS_PASSED, EstadoChip.ACTIVATED))
    }

    @Test
    fun `no se puede grabar un chip recien recibido sin validarlo`() {
        assertFalse(puedeTransicionarChip(EstadoChip.RECEIVED, EstadoChip.PERSONALIZING))
        assertFalse(puedeTransicionarChip(EstadoChip.RECEIVED, EstadoChip.RESERVED))
        assertTrue(puedeTransicionarChip(EstadoChip.RECEIVED, EstadoChip.VALIDATED))
    }

    @Test
    fun `no se puede volver hacia atras en el proceso`() {
        assertFalse(puedeTransicionarChip(EstadoChip.VERIFIED, EstadoChip.PROGRAMMED))
        assertFalse(puedeTransicionarChip(EstadoChip.LINKED, EstadoChip.VERIFIED))
        assertFalse(puedeTransicionarChip(EstadoChip.ACTIVATED, EstadoChip.LINKED))
    }

    // --- Reintento de escritura ---------------------------------------------

    @Test
    fun `personalizando admite repetirse a si mismo para el reintento seguro`() {
        // Es la transición que hace posible reintentar una escritura con la MISMA
        // clave de idempotencia tras un fallo de radio. Sin ella, el segundo
        // intento sería un salto inválido y el operario quedaría bloqueado con el
        // emblema en la mano.
        assertTrue(puedeTransicionarChip(EstadoChip.PERSONALIZING, EstadoChip.PERSONALIZING))
    }

    @Test
    fun `personalizando puede retroceder a reservado para liberar el puesto`() {
        assertTrue(puedeTransicionarChip(EstadoChip.PERSONALIZING, EstadoChip.RESERVED))
    }

    @Test
    fun `programado puede volver a personalizando para regrabar`() {
        assertTrue(puedeTransicionarChip(EstadoChip.PROGRAMMED, EstadoChip.PERSONALIZING))
    }

    // --- Cuarentena ---------------------------------------------------------

    @Test
    fun `cuarentena es alcanzable desde todos los estados operativos`() {
        val operativos = listOf(
            EstadoChip.RECEIVED,
            EstadoChip.VALIDATED,
            EstadoChip.RESERVED,
            EstadoChip.PERSONALIZING,
            EstadoChip.PROGRAMMED,
            EstadoChip.VERIFIED,
            EstadoChip.LINKED,
            EstadoChip.READY_FOR_HEAT_PRESS,
            EstadoChip.POST_PRESS_PASSED,
            EstadoChip.ACTIVATED,
        )
        for (estado in operativos) {
            assertTrue(
                puedeTransicionarChip(estado, EstadoChip.QUARANTINED),
                "se debe poder apartar una unidad desde $estado",
            )
        }
    }

    @Test
    fun `desde cuarentena solo se sale por las vias declaradas`() {
        val permitidos = TRANSICIONES_CHIP.getValue(EstadoChip.QUARANTINED)
        assertEquals(
            listOf(
                EstadoChip.VALIDATED,
                EstadoChip.RESERVED,
                EstadoChip.LINKED,
                EstadoChip.ACTIVATED,
                EstadoChip.REVOKED,
                EstadoChip.DESTROYED,
            ),
            permitidos,
        )
        // Rehabilitar directamente a PERSONALIZING no está permitido: una unidad
        // que salió de cuarentena vuelve a pasar por la validación.
        assertFalse(puedeTransicionarChip(EstadoChip.QUARANTINED, EstadoChip.PERSONALIZING))
        assertFalse(puedeTransicionarChip(EstadoChip.QUARANTINED, EstadoChip.PROGRAMMED))
    }

    // --- Estados terminales -------------------------------------------------

    @Test
    fun `destruido es terminal`() {
        assertTrue(TRANSICIONES_CHIP.getValue(EstadoChip.DESTROYED).isEmpty())
        for (estado in EstadoChip.entries) {
            assertFalse(
                puedeTransicionarChip(EstadoChip.DESTROYED, estado),
                "nada debería poder salir de DESTROYED, ni siquiera a $estado",
            )
        }
    }

    @Test
    fun `revocado solo puede acabar destruido`() {
        assertEquals(
            listOf(EstadoChip.DESTROYED),
            TRANSICIONES_CHIP.getValue(EstadoChip.REVOKED),
        )
        assertFalse(puedeTransicionarChip(EstadoChip.REVOKED, EstadoChip.ACTIVATED))
        assertFalse(puedeTransicionarChip(EstadoChip.REVOKED, EstadoChip.QUARANTINED))
    }

    // --- exigirTransicionChip ----------------------------------------------

    @Test
    fun `exigir una transicion valida no lanza`() {
        exigirTransicionChip(EstadoChip.VERIFIED, EstadoChip.LINKED)
    }

    @Test
    fun `exigir una transicion invalida lanza con los datos del salto`() {
        val excepcion = assertFailsWith<TransicionInvalidaException> {
            exigirTransicionChip(EstadoChip.RECEIVED, EstadoChip.ACTIVATED)
        }
        assertEquals("NfcChip", excepcion.entidad)
        assertEquals(EstadoChip.RECEIVED, excepcion.desde)
        assertEquals(EstadoChip.ACTIVATED, excepcion.hacia)
    }

    // --- Utilidades ---------------------------------------------------------

    @Test
    fun `los estados previos a la venta excluyen activado y los terminales`() {
        assertEquals(9, ESTADOS_PREVIOS_A_VENTA.size)
        assertFalse(ESTADOS_PREVIOS_A_VENTA.contains(EstadoChip.ACTIVATED))
        assertFalse(ESTADOS_PREVIOS_A_VENTA.contains(EstadoChip.QUARANTINED))
        assertFalse(ESTADOS_PREVIOS_A_VENTA.contains(EstadoChip.REVOKED))
        assertFalse(ESTADOS_PREVIOS_A_VENTA.contains(EstadoChip.DESTROYED))
        assertTrue(ESTADOS_PREVIOS_A_VENTA.contains(EstadoChip.POST_PRESS_PASSED))
    }

    @Test
    fun `desdeApi interpreta los nombres del servidor y tolera lo desconocido`() {
        assertEquals(EstadoChip.READY_FOR_HEAT_PRESS, EstadoChip.desdeApi("READY_FOR_HEAT_PRESS"))
        assertEquals(EstadoChip.ACTIVATED, EstadoChip.desdeApi("activated"))
        // Un estado nuevo en el servidor NO debe romper la app instalada.
        assertNull(EstadoChip.desdeApi("ESTADO_QUE_NO_EXISTE"))
        assertNull(EstadoChip.desdeApi(null))
    }

    @Test
    fun `cada estado tiene una etiqueta para el operario sin jerga tecnica`() {
        for (estado in EstadoChip.entries) {
            val etiqueta = estado.etiquetaOperario
            assertTrue(etiqueta.isNotBlank(), "$estado sin etiqueta")
            // La etiqueta no debe ser el nombre técnico: el operario no lee inglés
            // ni mayúsculas con guiones bajos.
            assertFalse(etiqueta == estado.name, "$estado muestra su nombre técnico")
            assertFalse(etiqueta.contains('_'))
        }
    }
}
