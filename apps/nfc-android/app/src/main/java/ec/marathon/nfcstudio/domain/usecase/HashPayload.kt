package ec.marathon.nfcstudio.domain.usecase

import java.security.MessageDigest

/**
 * Hash del payload grabado.
 *
 * Se envia al servidor en lugar del contenido literal. Motivo: el payload
 * incluye el token que viaja en la URL del chip; si se enviara entero, ese token
 * circularia dos veces por la red y aparaceria en los registros de acceso del
 * servidor y de cualquier proxy intermedio. El servidor solo necesita comprobar
 * que lo grabado corresponde a lo que ordeno grabar, y para eso basta el hash.
 *
 * SHA-256 sin sal: no es un secreto que haya que proteger contra fuerza bruta,
 * es una huella de integridad que el servidor debe poder recalcular. Anadir sal
 * la haria irreproducible en el otro extremo.
 */
object HashPayload {

    fun sha256Hex(bytes: ByteArray): String {
        val digestor = MessageDigest.getInstance("SHA-256")
        val resumen = digestor.digest(bytes)
        val constructor = StringBuilder(resumen.size * 2)
        for (byte in resumen) {
            val valor = byte.toInt() and 0xFF
            constructor.append(DIGITOS[valor ushr 4])
            constructor.append(DIGITOS[valor and 0x0F])
        }
        return constructor.toString()
    }

    /** Conveniencia para el hexadecimal que devuelve el proveedor. */
    fun deHex(payloadHex: String): String =
        sha256Hex(ec.marathon.nfcstudio.nfc.NdefCodec.desdeHex(payloadHex))

    private val DIGITOS = "0123456789abcdef".toCharArray()
}
