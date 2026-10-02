package ec.marathon.nfcstudio.nfc

import android.nfc.NdefMessage
import android.nfc.Tag
import android.nfc.TagLostException
import android.nfc.tech.Ndef
import android.nfc.tech.NfcA
import ec.marathon.nfcstudio.core.Registro
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Transporte real sobre la pila NFC de Android.
 *
 * Envuelve `android.nfc.tech.NfcA` (acceso crudo por paginas) y
 * `android.nfc.tech.Ndef` (acceso de alto nivel). Es el UNICO archivo de la
 * aplicacion que importa `android.nfc.tech.*`: todo lo demas trabaja contra
 * [TagTransport], y por eso todo lo demas es comprobable sin telefono.
 *
 * COMANDOS UTILIZADOS
 * -------------------
 * Solo se usan comandos del NFC Forum Type 2 Tag Operation Specification y los
 * de las hojas de datos publicas de NXP para la familia NTAG 21x:
 *
 *   READ        0x30 <pagina>                 -> devuelve 16 bytes (4 paginas)
 *   WRITE       0xA2 <pagina> <4 bytes>       -> escribe una pagina
 *   GET_VERSION 0x60                          -> devuelve 8 bytes
 *
 * NO se emite ningun otro comando. En particular NO se emiten comandos de
 * bloqueo, ni PWD_AUTH, ni nada relacionado con configuracion: esas operaciones
 * son irreversibles y este codigo no se ha podido validar contra chips reales
 * (ver README, seccion "Qué NO está probado").
 *
 * LIMITACION DE LA PLATAFORMA
 * ---------------------------
 * Android no permite tener dos tecnologias conectadas al mismo tag a la vez:
 * conectar `Ndef` desconecta `NfcA` y viceversa. Esta clase lo gestiona con
 * [usarNfcA] / [usarNdef], que conectan la tecnologia necesaria y dejan la otra
 * cerrada. Alternarlas en exceso aumenta el riesgo de perder el tag, asi que
 * cada operacion del proveedor se apoya en una sola de las dos.
 */
class AndroidTagTransport(private val tag: Tag) : TagTransport {

    /** La memoria de usuario de la familia NTAG 21x empieza en la pagina 4. */
    private val paginaInicialUsuario = 4
    private val bytesPorPagina = 4
    private val bytesPorLecturaRead = 16

    private var nfcA: NfcA? = null
    private var ndef: Ndef? = null

    // --- TagTransport -------------------------------------------------------

    override suspend fun readUserMemory(desplazamiento: Int, longitud: Int): ByteArray =
        usarNfcA { conexion ->
            require(desplazamiento >= 0 && longitud >= 0) { "Desplazamiento o longitud negativos" }
            if (longitud == 0) return@usarNfcA ByteArray(0)

            val paginaInicial = paginaInicialUsuario + (desplazamiento / bytesPorPagina)
            val desfaseEnPagina = desplazamiento % bytesPorPagina
            val bytesNecesarios = desfaseEnPagina + longitud

            val acumulado = ByteArray(
                // Se redondea al siguiente multiplo de 16 porque READ devuelve
                // 16 bytes de golpe y no se puede pedir menos.
                ((bytesNecesarios + bytesPorLecturaRead - 1) / bytesPorLecturaRead) * bytesPorLecturaRead,
            )

            var escritos = 0
            var pagina = paginaInicial
            while (escritos < acumulado.size) {
                val respuesta = conexion.transceive(byteArrayOf(0x30, pagina.toByte()))
                if (respuesta.size < bytesPorLecturaRead) {
                    throw errorNfc(
                        CodigoErrorNfc.TRANSPORT_ERROR,
                        "READ devolvió ${respuesta.size} bytes en la página $pagina",
                        retryable = true,
                    )
                }
                respuesta.copyInto(acumulado, escritos, 0, bytesPorLecturaRead)
                escritos += bytesPorLecturaRead
                pagina += bytesPorLecturaRead / bytesPorPagina
            }

            acumulado.copyOfRange(desfaseEnPagina, desfaseEnPagina + longitud)
        }

    /**
     * Escribe respetando la granularidad de pagina del chip.
     *
     * Si el rango pedido no empieza o no acaba en frontera de pagina, se lee la
     * pagina afectada, se mezcla y se reescribe completa. Escribir una pagina a
     * medias con ceros destruiria datos vecinos.
     */
    override suspend fun writeUserMemory(desplazamiento: Int, datos: ByteArray) {
        if (datos.isEmpty()) return
        require(desplazamiento >= 0) { "Desplazamiento negativo" }

        val desfaseEnPagina = desplazamiento % bytesPorPagina
        val inicioAlineado = desplazamiento - desfaseEnPagina
        val totalAlineado = ((desfaseEnPagina + datos.size + bytesPorPagina - 1) / bytesPorPagina) * bytesPorPagina

        val bufer: ByteArray = if (desfaseEnPagina == 0 && datos.size % bytesPorPagina == 0) {
            datos.copyOf()
        } else {
            // Lectura previa para no perder los bytes que comparten pagina.
            val existente = readUserMemory(inicioAlineado, totalAlineado)
            datos.copyInto(existente, desfaseEnPagina)
            existente
        }

        usarNfcA { conexion ->
            var indice = 0
            var pagina = paginaInicialUsuario + (inicioAlineado / bytesPorPagina)
            while (indice < bufer.size) {
                val marco = ByteArray(6)
                marco[0] = 0xA2.toByte() // WRITE
                marco[1] = pagina.toByte()
                bufer.copyInto(marco, 2, indice, indice + bytesPorPagina)
                conexion.transceive(marco)
                indice += bytesPorPagina
                pagina += 1
            }
        }
    }

    /**
     * Tunel de APDU crudos.
     *
     * Existe unicamente para el futuro proveedor de chips seguros, que recibiria
     * los APDU ya construidos y cifrados por el custodio de claves del servidor.
     * Hoy nadie lo llama: el proveedor NTAG 424 DNA esta sin implementar.
     */
    override suspend fun transceive(apdu: ByteArray): ByteArray = usarNfcA { conexion ->
        conexion.transceive(apdu)
    }

    override suspend fun close() = withContext(Dispatchers.IO) {
        cerrarSilencioso()
    }

    // --- Operaciones especificas de Android --------------------------------

    /**
     * GET_VERSION (0x60). Devuelve 8 bytes segun la hoja de datos publica de
     * NXP para NTAG 21x. Devuelve null si el chip no responde al comando, que
     * es lo que ocurre con etiquetas de otros fabricantes.
     *
     * PENDIENTE DE VALIDACION CON HARDWARE: el formato de la respuesta esta
     * documentado, pero no se ha comprobado contra chips reales en este entorno.
     */
    suspend fun obtenerVersion(): ByteArray? = try {
        usarNfcA { conexion ->
            val respuesta = conexion.transceive(byteArrayOf(0x60))
            if (respuesta.size >= 8) respuesta else null
        }
    } catch (error: Exception) {
        Registro.depuracion(ETIQUETA, "GET_VERSION no soportado por este chip.")
        null
    }

    /** UID en hexadecimal mayusculas. */
    fun uidHex(): String = NdefCodec.aHex(tag.id)

    /** Tecnologias que la pila NFC reporta, en nombre corto (NfcA, Ndef...). */
    fun tecnologias(): List<String> = tag.techList.map { it.substringAfterLast('.') }

    fun soportaNdef(): Boolean = tag.techList.any { it == Ndef::class.java.name }

    fun soportaNfcA(): Boolean = tag.techList.any { it == NfcA::class.java.name }

    /** Datos que solo expone la tecnologia Ndef de alto nivel. */
    data class InfoNdef(
        val escribible: Boolean,
        val capacidadMaxima: Int,
        val tipoNdef: String,
        val mensajeActual: ByteArray?,
        val puedeHacerseSoloLectura: Boolean,
    )

    suspend fun leerInfoNdef(): InfoNdef? {
        if (!soportaNdef()) return null
        return usarNdef { conexion ->
            InfoNdef(
                escribible = conexion.isWritable,
                capacidadMaxima = conexion.maxSize,
                tipoNdef = conexion.type ?: "desconocido",
                mensajeActual = runCatching { conexion.ndefMessage?.toByteArray() }.getOrNull(),
                puedeHacerseSoloLectura = runCatching { conexion.canMakeReadOnly() }.getOrDefault(false),
            )
        }
    }

    /**
     * Escritura por la via de alto nivel (`Ndef.writeNdefMessage`).
     *
     * Es la ruta preferida cuando la etiqueta expone la tecnologia Ndef: la
     * plataforma se encarga del TLV, del bloque de capacidad (CC) y del
     * troceado en paginas, y lleva anos rodada en miles de modelos de telefono.
     * La via cruda por NfcA queda como respaldo.
     */
    suspend fun escribirMensajeNdef(mensajeBytes: ByteArray) {
        usarNdef { conexion ->
            if (!conexion.isWritable) {
                throw errorNfc(
                    CodigoErrorNfc.TAG_READ_ONLY,
                    "La etiqueta reporta que no es escribible",
                )
            }
            if (mensajeBytes.size > conexion.maxSize) {
                throw errorNfc(
                    CodigoErrorNfc.INSUFFICIENT_MEMORY,
                    "El mensaje ocupa ${mensajeBytes.size} bytes y el área NDEF admite ${conexion.maxSize}",
                )
            }
            conexion.writeNdefMessage(NdefMessage(mensajeBytes))
        }
    }

    suspend fun leerMensajeNdef(): ByteArray? = if (!soportaNdef()) {
        null
    } else {
        usarNdef { conexion -> runCatching { conexion.ndefMessage?.toByteArray() }.getOrNull() }
    }

    // --- Gestion de conexion ------------------------------------------------

    private suspend fun <T> usarNfcA(bloque: (NfcA) -> T): T = withContext(Dispatchers.IO) {
        if (ndef != null) {
            // Android desconecta la otra tecnologia por su cuenta, pero se
            // cierra explicitamente para no dejar el objeto en estado ambiguo.
            runCatching { ndef?.close() }
            ndef = null
        }
        val conexion = nfcA ?: NfcA.get(tag)?.also { nfcA = it }
            ?: throw errorNfc(
                CodigoErrorNfc.TAG_TYPE_UNSUPPORTED,
                "La etiqueta no expone la tecnología NfcA",
            )
        try {
            if (!conexion.isConnected) conexion.connect()
            bloque(conexion)
        } catch (error: TagLostException) {
            throw errorNfc(CodigoErrorNfc.TAG_LOST, describirError(error), retryable = true)
        } catch (error: NfcOperationException) {
            throw error
        } catch (error: IOException) {
            throw errorNfc(CodigoErrorNfc.TRANSPORT_ERROR, describirError(error), retryable = true)
        }
    }

    private suspend fun <T> usarNdef(bloque: (Ndef) -> T): T = withContext(Dispatchers.IO) {
        if (nfcA != null) {
            runCatching { nfcA?.close() }
            nfcA = null
        }
        val conexion = ndef ?: Ndef.get(tag)?.also { ndef = it }
            ?: throw errorNfc(
                CodigoErrorNfc.TAG_NOT_NDEF,
                "La etiqueta no expone la tecnología Ndef",
            )
        try {
            if (!conexion.isConnected) conexion.connect()
            bloque(conexion)
        } catch (error: TagLostException) {
            throw errorNfc(CodigoErrorNfc.TAG_LOST, describirError(error), retryable = true)
        } catch (error: NfcOperationException) {
            throw error
        } catch (error: android.nfc.FormatException) {
            throw errorNfc(CodigoErrorNfc.TAG_NOT_NDEF, describirError(error))
        } catch (error: IOException) {
            throw errorNfc(CodigoErrorNfc.TRANSPORT_ERROR, describirError(error), retryable = true)
        }
    }

    private fun cerrarSilencioso() {
        runCatching { nfcA?.close() }
        runCatching { ndef?.close() }
        nfcA = null
        ndef = null
    }

    private companion object {
        const val ETIQUETA = "TransporteNfc"
    }
}
