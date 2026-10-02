package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.domain.model.MEMORIA_USUARIO_BYTES
import ec.marathon.nfcstudio.domain.model.TipoChip

/**
 * Codificacion y decodificacion de registros NDEF de tipo URI.
 *
 * FUENTE NORMATIVA: NFC Forum, "URI Record Type Definition" (RTD-URI 1.0) y
 * "NFC Data Exchange Format (NDEF) 1.0". La tabla de prefijos de abreviatura y
 * la estructura de cabecera estan definidas en esos documentos publicos.
 *
 * PORT FIEL de `packages/nfc-contracts/src/ndef.ts`. La equivalencia debe ser
 * BYTE A BYTE: el servidor calcula el hash de lo que la app dice haber escrito
 * y la web del aficionado decodifica lo que lee el telefono del comprador. Si
 * esta implementacion y la de TypeScript divergieran en un solo byte, el hash
 * no cuadraria y la unidad acabaria en cuarentena sin motivo real.
 *
 * Este objeto es LOGICA PURA: no habla con ningun chip, no importa nada de
 * `android.*`. Por eso se puede probar entero en la JVM sin emulador, que es
 * justo lo que hace `NdefCodecTest`.
 *
 * NOTA sobre `android.nfc.NdefRecord.createUri()`: la plataforma ofrece su
 * propio codificador, y el proveedor NTAG 21x lo usa para la ruta de escritura
 * de alto nivel. Aun asi este codec existe y es el que manda, porque:
 *   1. permite calcular el payload exacto ANTES de tocar el chip (control de
 *      capacidad y hash de auditoria),
 *   2. permite decodificar memoria cruda leida por NfcA cuando `Ndef` no esta
 *      disponible,
 *   3. es comprobable sin dispositivo.
 */
object NdefCodec {

    /**
     * Tabla de prefijos abreviados de RTD-URI. El indice es el primer byte del
     * payload. Abreviar ahorra bytes, lo cual importa: una NTAG213 tiene 144
     * bytes de memoria de usuario.
     *
     * Son 36 entradas (0x00..0x23). El resto de codigos esta reservado por el
     * NFC Forum y decodificarlos devuelve null.
     */
    val PREFIJOS_URI: List<String> = listOf(
        "", // 0x00 sin abreviatura
        "http://www.", // 0x01
        "https://www.", // 0x02
        "http://", // 0x03
        "https://", // 0x04
        "tel:", // 0x05
        "mailto:", // 0x06
        "ftp://anonymous:anonymous@", // 0x07
        "ftp://ftp.", // 0x08
        "ftps://", // 0x09
        "sftp://", // 0x0A
        "smb://", // 0x0B
        "nfs://", // 0x0C
        "ftp://", // 0x0D
        "dav://", // 0x0E
        "news:", // 0x0F
        "telnet://", // 0x10
        "imap:", // 0x11
        "rtsp://", // 0x12
        "urn:", // 0x13
        "pop:", // 0x14
        "sip:", // 0x15
        "sips:", // 0x16
        "tftp:", // 0x17
        "btspp://", // 0x18
        "btl2cap://", // 0x19
        "btgoep://", // 0x1A
        "tcpobex://", // 0x1B
        "irdaobex://", // 0x1C
        "file://", // 0x1D
        "urn:epc:id:", // 0x1E
        "urn:epc:tag:", // 0x1F
        "urn:epc:pat:", // 0x20
        "urn:epc:raw:", // 0x21
        "urn:epc:", // 0x22
        "urn:nfc:", // 0x23
    )

    // --- Bits de la cabecera de un registro NDEF ---------------------------
    private const val MB = 0x80 // Message Begin
    private const val ME = 0x40 // Message End
    private const val SR = 0x10 // Short Record (longitud de payload en 1 byte)
    private const val IL = 0x08 // ID Length presente
    private const val TNF_WELL_KNOWN = 0x01
    private const val RTD_URI = 0x55 // 'U'

    // --- TLV de Type 2 Tag --------------------------------------------------
    const val TLV_NULL = 0x00
    const val TLV_NDEF = 0x03
    const val TLV_TERMINADOR = 0xFE

    data class PrefijoSeleccionado(val codigo: Int, val resto: String)

    /** Elige el prefijo abreviado mas largo que coincida, para ahorrar memoria. */
    fun seleccionarPrefijoUri(uri: String): PrefijoSeleccionado {
        var mejorCodigo = 0
        var mejorLongitud = 0
        for (indice in 1 until PREFIJOS_URI.size) {
            val prefijo = PREFIJOS_URI[indice]
            if (uri.startsWith(prefijo) && prefijo.length > mejorLongitud) {
                mejorCodigo = indice
                mejorLongitud = prefijo.length
            }
        }
        return PrefijoSeleccionado(mejorCodigo, uri.substring(mejorLongitud))
    }

    /**
     * Codifica una URI como un mensaje NDEF de un solo registro.
     * Devuelve los bytes del MENSAJE, sin el envoltorio TLV del Type 2 Tag.
     */
    fun codificarMensajeUriNdef(uri: String): ByteArray {
        require(uri.isNotEmpty()) { "La URI no puede estar vacía" }

        val (codigo, resto) = seleccionarPrefijoUri(uri)
        val bytesResto = resto.toByteArray(Charsets.UTF_8)
        val longitudPayload = 1 + bytesResto.size

        // Un unico registro: es a la vez principio y fin del mensaje.
        val cabecera = MB or ME or TNF_WELL_KNOWN or (if (longitudPayload < 256) SR else 0)

        val salida = ArrayList<Byte>(longitudPayload + 8)
        salida.add(cabecera.toByte())
        salida.add(1) // type length

        if (longitudPayload < 256) {
            salida.add(longitudPayload.toByte())
        } else {
            salida.add(((longitudPayload ushr 24) and 0xFF).toByte())
            salida.add(((longitudPayload ushr 16) and 0xFF).toByte())
            salida.add(((longitudPayload ushr 8) and 0xFF).toByte())
            salida.add((longitudPayload and 0xFF).toByte())
        }

        salida.add(RTD_URI.toByte())
        salida.add(codigo.toByte())
        for (byte in bytesResto) salida.add(byte)

        return salida.toByteArray()
    }

    /** Decodifica un mensaje NDEF de un registro URI. Devuelve null si no lo es. */
    fun decodificarMensajeUriNdef(bytes: ByteArray): String? {
        if (bytes.size < 5) return null

        val cabecera = bytes[0].entero()
        val tnf = cabecera and 0x07
        if (tnf != TNF_WELL_KNOWN) return null

        val esCorto = (cabecera and SR) != 0
        val longitudTipo = bytes[1].entero()
        if (longitudTipo != 1) return null

        var cursor = 2
        val longitudPayload: Int
        if (esCorto) {
            longitudPayload = bytes[cursor].entero()
            cursor += 1
        } else {
            if (bytes.size < cursor + 4) return null
            // Se calcula en Long para que un valor con el bit alto puesto no se
            // convierta en negativo, igual que el `>>> 0` del original.
            val largo = (bytes[cursor].entero().toLong() shl 24) +
                (bytes[cursor + 1].entero().toLong() shl 16) +
                (bytes[cursor + 2].entero().toLong() shl 8) +
                bytes[cursor + 3].entero().toLong()
            if (largo > Int.MAX_VALUE) return null
            longitudPayload = largo.toInt()
            cursor += 4
        }

        // El flag IL anade un byte de longitud de ID antes del tipo.
        val tieneLongitudId = (cabecera and IL) != 0
        var longitudId = 0
        if (tieneLongitudId) {
            if (cursor >= bytes.size) return null
            longitudId = bytes[cursor].entero()
            cursor += 1
        }

        if (cursor >= bytes.size) return null
        if (bytes[cursor].entero() != RTD_URI) return null
        cursor += 1 + longitudId

        if (longitudPayload < 1 || cursor + longitudPayload > bytes.size) return null

        val codigoPrefijo = bytes[cursor].entero()
        val prefijo = PREFIJOS_URI.getOrNull(codigoPrefijo) ?: return null

        val resto = String(bytes, cursor + 1, longitudPayload - 1, Charsets.UTF_8)
        return prefijo + resto
    }

    /**
     * Envuelve un mensaje NDEF en el TLV de un Type 2 Tag (la familia NTAG 21x).
     * Estructura: 0x03 | longitud | mensaje | 0xFE (terminador).
     *
     * El umbral es `< 0xFF` (no `<=`) porque 0xFF es el indicador de longitud
     * de tres bytes: un mensaje de exactamente 255 bytes DEBE usar el formato
     * largo. Esta sutileza esta copiada tal cual del original en TypeScript.
     */
    fun envolverTlvType2(mensaje: ByteArray): ByteArray {
        val salida = ArrayList<Byte>(mensaje.size + 5)
        salida.add(TLV_NDEF.toByte())
        if (mensaje.size < 0xFF) {
            salida.add(mensaje.size.toByte())
        } else {
            salida.add(0xFF.toByte())
            salida.add(((mensaje.size ushr 8) and 0xFF).toByte())
            salida.add((mensaje.size and 0xFF).toByte())
        }
        for (byte in mensaje) salida.add(byte)
        salida.add(TLV_TERMINADOR.toByte())
        return salida.toByteArray()
    }

    /** Extrae el mensaje NDEF del TLV de un Type 2 Tag. Null si no lo encuentra. */
    fun desenvolverTlvType2(datos: ByteArray): ByteArray? {
        var cursor = 0
        while (cursor < datos.size) {
            val etiqueta = datos[cursor].entero()

            if (etiqueta == TLV_NULL) {
                cursor += 1 // NULL TLV: relleno
                continue
            }
            if (etiqueta == TLV_TERMINADOR) return null // terminador sin hallar NDEF

            if (cursor + 1 >= datos.size) return null
            var longitud = datos[cursor + 1].entero()
            var tamanoCabecera = 2
            if (longitud == 0xFF) {
                if (cursor + 3 >= datos.size) return null
                longitud = (datos[cursor + 2].entero() shl 8) + datos[cursor + 3].entero()
                tamanoCabecera = 4
            }

            if (etiqueta == TLV_NDEF) {
                val inicio = cursor + tamanoCabecera
                if (inicio + longitud > datos.size) return null
                return datos.copyOfRange(inicio, inicio + longitud)
            }
            cursor += tamanoCabecera + longitud
        }
        return null
    }

    data class ComprobacionCapacidad(
        val cabe: Boolean,
        val bytesRequeridos: Int,
        val bytesDisponibles: Int,
    )

    /**
     * Comprueba si una URI cabe en el chip, contando el envoltorio TLV.
     *
     * Se valida ANTES de escribir: una escritura truncada deja el chip
     * inservible y el emblema ya cosido al jersey.
     */
    fun comprobarQueLaUriCabe(uri: String, tipoChip: TipoChip): ComprobacionCapacidad {
        val disponibles = MEMORIA_USUARIO_BYTES[tipoChip] ?: 0
        val requeridos = envolverTlvType2(codificarMensajeUriNdef(uri)).size
        return ComprobacionCapacidad(
            cabe = requeridos <= disponibles,
            bytesRequeridos = requeridos,
            bytesDisponibles = disponibles,
        )
    }

    /** Utilidad de depuracion: bytes a hexadecimal legible en mayusculas. */
    fun aHex(bytes: ByteArray): String {
        val constructor = StringBuilder(bytes.size * 2)
        for (byte in bytes) {
            val valor = byte.entero()
            constructor.append(DIGITOS_HEX[valor ushr 4])
            constructor.append(DIGITOS_HEX[valor and 0x0F])
        }
        return constructor.toString()
    }

    fun desdeHex(hex: String): ByteArray {
        val limpio = hex.replace(Regex("[^0-9a-fA-F]"), "")
        require(limpio.length % 2 == 0) { "Cadena hexadecimal de longitud impar" }
        val salida = ByteArray(limpio.length / 2)
        for (indice in salida.indices) {
            salida[indice] = limpio.substring(indice * 2, indice * 2 + 2).toInt(16).toByte()
        }
        return salida
    }

    private val DIGITOS_HEX = "0123456789ABCDEF".toCharArray()

    /** Byte de Kotlin (con signo) leido como entero sin signo 0..255. */
    private fun Byte.entero(): Int = this.toInt() and 0xFF
}
