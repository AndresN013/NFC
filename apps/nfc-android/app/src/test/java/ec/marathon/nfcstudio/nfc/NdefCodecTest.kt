package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.domain.model.TipoChip
import org.junit.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pruebas de [NdefCodec].
 *
 * Estas pruebas son el seguro de que la implementación Kotlin y la de TypeScript
 * (`packages/nfc-contracts/src/ndef.ts`) producen LOS MISMOS BYTES. Si divergen,
 * el hash que la app envía al servidor no coincidirá con el que el servidor
 * calcula, y unidades perfectamente grabadas acabarán en cuarentena.
 *
 * Por eso varias pruebas comparan contra bytes literales escritos a mano a partir
 * de la especificación RTD-URI, no contra el resultado de la propia función: una
 * prueba que dice `decode(encode(x)) == x` no detecta un error de formato que
 * ambas funciones compartan.
 */
class NdefCodecTest {

    // --- Tabla de prefijos --------------------------------------------------

    @Test
    fun `la tabla de prefijos tiene las 36 entradas del NFC Forum`() {
        // 0x00..0x23. Si alguien añade una, el índice de todas las posteriores
        // cambiaría y cada chip ya grabado se decodificaría mal.
        assertEquals(36, NdefCodec.PREFIJOS_URI.size)
        assertEquals("", NdefCodec.PREFIJOS_URI[0x00])
        assertEquals("http://www.", NdefCodec.PREFIJOS_URI[0x01])
        assertEquals("https://www.", NdefCodec.PREFIJOS_URI[0x02])
        assertEquals("http://", NdefCodec.PREFIJOS_URI[0x03])
        assertEquals("https://", NdefCodec.PREFIJOS_URI[0x04])
        assertEquals("urn:nfc:", NdefCodec.PREFIJOS_URI[0x23])
    }

    @Test
    fun `elige el prefijo mas largo que coincida`() {
        // "https://www.x" empieza por "https://" (0x04) y por "https://www."
        // (0x02). Debe ganar el más largo, que ahorra cuatro bytes de memoria.
        val seleccion = NdefCodec.seleccionarPrefijoUri("https://www.marathon.ec/v/AB")
        assertEquals(0x02, seleccion.codigo)
        assertEquals("marathon.ec/v/AB", seleccion.resto)
    }

    @Test
    fun `usa el codigo 0 cuando ningun prefijo coincide`() {
        val seleccion = NdefCodec.seleccionarPrefijoUri("mev://interno/algo")
        assertEquals(0x00, seleccion.codigo)
        assertEquals("mev://interno/algo", seleccion.resto)
    }

    @Test
    fun `reconoce el prefijo mas largo tambien en las entradas urn`() {
        // "urn:epc:id:" (0x1E) debe ganar a "urn:" (0x13) y a "urn:epc:" (0x22).
        val seleccion = NdefCodec.seleccionarPrefijoUri("urn:epc:id:sgtin:0614141.112345.400")
        assertEquals(0x1E, seleccion.codigo)
        assertEquals("sgtin:0614141.112345.400", seleccion.resto)
    }

    // --- Codificación byte a byte ------------------------------------------

    @Test
    fun `codifica un registro corto con los bytes exactos de la especificacion`() {
        val uri = "https://escudo-vivo.marathon.ec/v/AB"
        val bytes = NdefCodec.codificarMensajeUriNdef(uri)

        val resto = "escudo-vivo.marathon.ec/v/AB"
        val longitudPayload = 1 + resto.length // prefijo + texto

        // Cabecera esperada: MB(0x80) | ME(0x40) | SR(0x10) | TNF_WELL_KNOWN(0x01)
        assertEquals(0xD1, bytes[0].toInt() and 0xFF)
        // Longitud del tipo: siempre 1 ("U")
        assertEquals(0x01, bytes[1].toInt() and 0xFF)
        // Longitud del payload en UN byte, porque es un registro corto
        assertEquals(longitudPayload, bytes[2].toInt() and 0xFF)
        // Tipo: 'U' = 0x55
        assertEquals(0x55, bytes[3].toInt() and 0xFF)
        // Código de prefijo: "https://" = 0x04
        assertEquals(0x04, bytes[4].toInt() and 0xFF)
        // El resto va en UTF-8 a partir del quinto byte
        assertEquals(resto, String(bytes, 5, bytes.size - 5, Charsets.UTF_8))
        assertEquals(5 + resto.length, bytes.size)
        assertTrue(NdefCodec.aHex(bytes).startsWith("D1011D5504"))
    }

    @Test
    fun `codifica un registro largo sin la bandera de registro corto`() {
        // Con más de 255 bytes de payload la longitud ocupa cuatro bytes y el bit
        // SR debe estar APAGADO. Es el caso que más fácilmente se implementa mal.
        val resto = "a".repeat(300)
        val bytes = NdefCodec.codificarMensajeUriNdef("https://$resto")

        val cabecera = bytes[0].toInt() and 0xFF
        assertEquals(0xC1, cabecera) // MB | ME | TNF, SIN SR
        assertEquals(0x00, cabecera and 0x10) // SR apagado, explícito
        assertEquals(0x01, bytes[1].toInt() and 0xFF)

        val longitudPayload = 301
        assertEquals(0x00, bytes[2].toInt() and 0xFF)
        assertEquals(0x00, bytes[3].toInt() and 0xFF)
        assertEquals((longitudPayload shr 8) and 0xFF, bytes[4].toInt() and 0xFF)
        assertEquals(longitudPayload and 0xFF, bytes[5].toInt() and 0xFF)
        assertEquals(0x55, bytes[6].toInt() and 0xFF)
        assertEquals(0x04, bytes[7].toInt() and 0xFF)
    }

    @Test
    fun `rechaza una uri vacia`() {
        assertFailsWith<IllegalArgumentException> {
            NdefCodec.codificarMensajeUriNdef("")
        }
    }

    // --- Ida y vuelta -------------------------------------------------------

    @Test
    fun `ida y vuelta para todas las formas de uri que usa el proyecto`() {
        val casos = listOf(
            "https://escudo-vivo.marathon.ec/v/7bQx9LmNpR",
            "https://www.marathon.ec/verificar/ABC123",
            "http://10.0.2.2:3000/v/PRUEBA",
            "http://www.ejemplo.com/a",
            "tel:+593999999999",
            "mailto:soporte@marathon.ec",
            "urn:nfc:algo",
            "mev://sin-prefijo-conocido/1",
            // Acentos y eñe: el payload va en UTF-8 y ocupa más bytes que
            // caracteres. Si alguien confundiera longitud de cadena con longitud
            // de bytes, esta prueba lo detecta.
            "https://marathon.ec/camiseta/ñandú-edición",
        )

        for (uri in casos) {
            val mensaje = NdefCodec.codificarMensajeUriNdef(uri)
            assertEquals(uri, NdefCodec.decodificarMensajeUriNdef(mensaje), "falló con: $uri")
        }
    }

    @Test
    fun `ida y vuelta de un registro largo`() {
        val uri = "https://escudo-vivo.marathon.ec/v/" + "Z".repeat(400)
        val mensaje = NdefCodec.codificarMensajeUriNdef(uri)
        assertEquals(uri, NdefCodec.decodificarMensajeUriNdef(mensaje))
    }

    @Test
    fun `ida y vuelta pasando por el envoltorio TLV`() {
        val uri = "https://escudo-vivo.marathon.ec/v/7bQx9LmNpR"
        val tlv = NdefCodec.envolverTlvType2(NdefCodec.codificarMensajeUriNdef(uri))
        val mensaje = NdefCodec.desenvolverTlvType2(tlv)
        assertEquals(uri, mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) })
    }

    // --- Decodificación defensiva ------------------------------------------

    @Test
    fun `decodificar devuelve nulo ante entradas que no son registros uri`() {
        // Demasiado corto
        assertNull(NdefCodec.decodificarMensajeUriNdef(byteArrayOf(0xD1.toByte(), 0x01)))
        // TNF distinto de well-known (aquí 0x02, media type)
        assertNull(
            NdefCodec.decodificarMensajeUriNdef(
                byteArrayOf(0xD2.toByte(), 0x01, 0x03, 0x55, 0x04, 0x61),
            ),
        )
        // Longitud de tipo distinta de 1
        assertNull(
            NdefCodec.decodificarMensajeUriNdef(
                byteArrayOf(0xD1.toByte(), 0x02, 0x03, 0x55, 0x04, 0x61),
            ),
        )
        // Tipo distinto de 'U' (aquí 'T', un registro de texto)
        assertNull(
            NdefCodec.decodificarMensajeUriNdef(
                byteArrayOf(0xD1.toByte(), 0x01, 0x03, 0x54, 0x04, 0x61),
            ),
        )
        // Código de prefijo fuera de la tabla (0x40 no existe)
        assertNull(
            NdefCodec.decodificarMensajeUriNdef(
                byteArrayOf(0xD1.toByte(), 0x01, 0x02, 0x55, 0x40, 0x61),
            ),
        )
        // Longitud de payload mayor que los bytes disponibles: mensaje truncado,
        // que es justo lo que deja una escritura interrumpida a mitad.
        assertNull(
            NdefCodec.decodificarMensajeUriNdef(
                byteArrayOf(0xD1.toByte(), 0x01, 0x20, 0x55, 0x04, 0x61),
            ),
        )
    }

    @Test
    fun `decodifica un registro con identificador presente`() {
        // Con la bandera IL (0x08) aparece un byte de longitud de ID tras la
        // longitud del payload. La app no lo genera, pero puede leerlo de un chip
        // escrito por otro sistema.
        val resto = "marathon.ec/v/AB"
        val payload = byteArrayOf(0x04) + resto.toByteArray(Charsets.UTF_8)
        val idRegistro = byteArrayOf(0x41) // "A"
        val bytes = byteArrayOf(
            (0x80 or 0x40 or 0x10 or 0x08 or 0x01).toByte(), // MB|ME|SR|IL|TNF
            0x01, // longitud del tipo
            payload.size.toByte(),
            idRegistro.size.toByte(),
            0x55, // 'U'
        ) + idRegistro + payload

        assertEquals("https://$resto", NdefCodec.decodificarMensajeUriNdef(bytes))
    }

    // --- TLV de Type 2 Tag --------------------------------------------------

    @Test
    fun `el TLV corto usa un solo byte de longitud y termina en 0xFE`() {
        val mensaje = byteArrayOf(1, 2, 3, 4, 5)
        val tlv = NdefCodec.envolverTlvType2(mensaje)

        assertEquals(0x03, tlv[0].toInt() and 0xFF)
        assertEquals(5, tlv[1].toInt() and 0xFF)
        assertContentEquals(mensaje, tlv.copyOfRange(2, 7))
        assertEquals(0xFE, tlv[7].toInt() and 0xFF)
        assertEquals(8, tlv.size)
    }

    @Test
    fun `un mensaje de 255 bytes usa el TLV de tres bytes`() {
        // El umbral es `< 0xFF`, no `<=`: 255 ya obliga al formato largo, porque
        // 0xFF es el indicador del formato largo. Copiado tal cual del original.
        val mensaje = ByteArray(255) { 0x41 }
        val tlv = NdefCodec.envolverTlvType2(mensaje)

        assertEquals(0x03, tlv[0].toInt() and 0xFF)
        assertEquals(0xFF, tlv[1].toInt() and 0xFF)
        assertEquals(0x00, tlv[2].toInt() and 0xFF)
        assertEquals(0xFF, tlv[3].toInt() and 0xFF)
        assertEquals(255 + 5, tlv.size) // 0x03 + 0xFF + 2 bytes + mensaje + 0xFE
        assertContentEquals(mensaje, NdefCodec.desenvolverTlvType2(tlv))
    }

    @Test
    fun `un mensaje de 254 bytes sigue usando el TLV corto`() {
        val mensaje = ByteArray(254) { 0x41 }
        val tlv = NdefCodec.envolverTlvType2(mensaje)
        assertEquals(254, tlv[1].toInt() and 0xFF)
        assertContentEquals(mensaje, NdefCodec.desenvolverTlvType2(tlv))
    }

    @Test
    fun `desenvolver salta el relleno de TLV nulos`() {
        // Los chips recién formateados traen bytes 0x00 de relleno antes del TLV
        // de datos. Si no se saltaran, el chip parecería vacío.
        val mensaje = NdefCodec.codificarMensajeUriNdef("https://marathon.ec/v/AB")
        val conRelleno = byteArrayOf(0x00, 0x00, 0x00) +
            NdefCodec.envolverTlvType2(mensaje)

        assertContentEquals(mensaje, NdefCodec.desenvolverTlvType2(conRelleno))
    }

    @Test
    fun `desenvolver salta un TLV de otro tipo antes del de datos`() {
        // TLV 0x01 (Lock Control), longitud 3, tres bytes de contenido.
        val otroTlv = byteArrayOf(0x01, 0x03, 0x11, 0x22, 0x33)
        val mensaje = NdefCodec.codificarMensajeUriNdef("https://marathon.ec/v/AB")
        val datos = otroTlv + NdefCodec.envolverTlvType2(mensaje)

        assertContentEquals(mensaje, NdefCodec.desenvolverTlvType2(datos))
    }

    @Test
    fun `desenvolver devuelve nulo en memoria en blanco o truncada`() {
        // Chip en blanco: todo ceros y ningún TLV de datos.
        assertNull(NdefCodec.desenvolverTlvType2(ByteArray(16)))
        // Terminador antes de hallar datos.
        assertNull(NdefCodec.desenvolverTlvType2(byteArrayOf(0xFE.toByte(), 0x00)))
        // TLV de datos que declara más longitud de la que hay: escritura cortada.
        assertNull(NdefCodec.desenvolverTlvType2(byteArrayOf(0x03, 0x20, 0x01, 0x02)))
    }

    // --- Capacidad ----------------------------------------------------------

    @Test
    fun `comprueba la capacidad real de cada familia NTAG`() {
        val uri = "https://escudo-vivo.marathon.ec/v/7bQx9LmNpR"

        val en213 = NdefCodec.comprobarQueLaUriCabe(uri, TipoChip.NTAG213)
        assertEquals(144, en213.bytesDisponibles)
        assertTrue(en213.cabe)

        assertEquals(504, NdefCodec.comprobarQueLaUriCabe(uri, TipoChip.NTAG215).bytesDisponibles)
        assertEquals(888, NdefCodec.comprobarQueLaUriCabe(uri, TipoChip.NTAG216).bytesDisponibles)

        // El tamaño requerido debe contar el envoltorio TLV, no solo el mensaje.
        val mensaje = NdefCodec.codificarMensajeUriNdef(uri)
        assertEquals(NdefCodec.envolverTlvType2(mensaje).size, en213.bytesRequeridos)
        assertTrue(en213.bytesRequeridos > mensaje.size)
    }

    @Test
    fun `una uri que no cabe en una NTAG213 si cabe en una NTAG216`() {
        // 200 caracteres de ruta: pasa de los 144 bytes de una 213.
        val uri = "https://escudo-vivo.marathon.ec/v/" + "X".repeat(200)

        assertFalse(NdefCodec.comprobarQueLaUriCabe(uri, TipoChip.NTAG213).cabe)
        assertTrue(NdefCodec.comprobarQueLaUriCabe(uri, TipoChip.NTAG215).cabe)
        assertTrue(NdefCodec.comprobarQueLaUriCabe(uri, TipoChip.NTAG216).cabe)
    }

    @Test
    fun `un tipo de chip desconocido no admite ninguna uri`() {
        // Cero bytes disponibles: nunca cabe. Es lo correcto, porque escribir en
        // un chip cuya capacidad no conocemos es lo que inutiliza inventario.
        val comprobacion = NdefCodec.comprobarQueLaUriCabe(
            "https://marathon.ec/v/AB",
            TipoChip.UNKNOWN,
        )
        assertEquals(0, comprobacion.bytesDisponibles)
        assertFalse(comprobacion.cabe)
    }

    // --- Hexadecimal --------------------------------------------------------

    @Test
    fun `hexadecimal ida y vuelta en mayusculas`() {
        val bytes = byteArrayOf(0x00, 0x0F, 0x10, 0x7F, 0xFF.toByte(), 0xA2.toByte())
        val hex = NdefCodec.aHex(bytes)
        assertEquals("000F107FFFA2", hex)
        assertContentEquals(bytes, NdefCodec.desdeHex(hex))
    }

    @Test
    fun `desdeHex ignora separadores y rechaza longitudes impares`() {
        assertContentEquals(byteArrayOf(0x04, 0xA1.toByte()), NdefCodec.desdeHex("04:A1"))
        assertContentEquals(byteArrayOf(0x04, 0xA1.toByte()), NdefCodec.desdeHex("04 a1"))
        assertFailsWith<IllegalArgumentException> { NdefCodec.desdeHex("04A") }
    }
}
