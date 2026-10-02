package ec.marathon.nfcstudio.nfc

/**
 * Transporte de bajo nivel hacia el chip.
 *
 * Portado de `TagTransport` en `packages/nfc-contracts/src/provider.ts`.
 *
 * En Android lo implementa la capa que envuelve `android.nfc`
 * ([AndroidTagTransport]); en el simulador lo implementa un objeto en memoria
 * ([TransporteSimulado]). Aislarlo es lo que permite probar TODA la logica de
 * los proveedores en la JVM, sin telefono y sin chips.
 *
 * Las funciones son `suspend` porque cada una supone una transaccion de radio
 * que puede tardar decenas de milisegundos y que jamas debe ocurrir en el hilo
 * principal (Android lanza IllegalStateException si se intenta).
 */
interface TagTransport {

    /** Lee [longitud] bytes de la memoria de usuario desde [desplazamiento]. */
    suspend fun readUserMemory(desplazamiento: Int, longitud: Int): ByteArray

    /** Escribe en la memoria de usuario desde [desplazamiento]. */
    suspend fun writeUserMemory(desplazamiento: Int, datos: ByteArray)

    /**
     * Intercambia un APDU crudo.
     *
     * Lanza NOT_IMPLEMENTED si el transporte no lo soporta. Existe unicamente
     * como tunel para el futuro proveedor de chips seguros: los APDU llegarian
     * ya construidos y cifrados por el custodio de claves del servidor, y el
     * telefono se limitaria a retransmitirlos sin entenderlos.
     */
    suspend fun transceive(apdu: ByteArray): ByteArray

    /** Cierra la conexion con el tag. */
    suspend fun close()
}

/**
 * Chip virtual en memoria. Solo para el modo simulacion y para las pruebas.
 */
class TagSimulado(
    val uid: String,
    val tipoChip: ec.marathon.nfcstudio.domain.model.TipoChip,
    tamanoMemoria: Int,
) {
    var memoria: ByteArray = ByteArray(tamanoMemoria)
        private set

    var soloLectura: Boolean = false
    var configuracionBloqueada: Boolean = false

    /** Contador de lecturas simulado, para ejercitar la logica anti-replay. */
    var contadorLecturas: Int = 0

    fun escribir(desplazamiento: Int, datos: ByteArray) {
        datos.copyInto(memoria, desplazamiento)
    }

    /** Solo para pruebas: corrompe la memoria como lo haria una prensa a 180 C. */
    fun corromperMemoria() {
        memoria = ByteArray(memoria.size) { 0xFF.toByte() }
    }

    companion object {
        fun crear(
            uid: String = "04A1B2C3D4E580",
            tipoChip: ec.marathon.nfcstudio.domain.model.TipoChip =
                ec.marathon.nfcstudio.domain.model.TipoChip.NTAG213,
        ): TagSimulado {
            val tamano = ec.marathon.nfcstudio.domain.model.MEMORIA_USUARIO_BYTES[tipoChip] ?: 144
            return TagSimulado(uid, tipoChip, tamano)
        }
    }
}

/**
 * Transporte en memoria. Permite ejercitar incluso el proveedor NTAG 21x real
 * sin hardware, porque este solo conoce `TagTransport`.
 */
class TransporteSimulado(private val tag: TagSimulado) : TagTransport {

    override suspend fun readUserMemory(desplazamiento: Int, longitud: Int): ByteArray {
        if (desplazamiento + longitud > tag.memoria.size) {
            throw errorNfc(
                CodigoErrorNfc.TRANSPORT_ERROR,
                "Lectura fuera de rango: $desplazamiento+$longitud",
            )
        }
        return tag.memoria.copyOfRange(desplazamiento, desplazamiento + longitud)
    }

    override suspend fun writeUserMemory(desplazamiento: Int, datos: ByteArray) {
        if (tag.soloLectura) {
            throw errorNfc(
                CodigoErrorNfc.TAG_READ_ONLY,
                "El chip simulado está bloqueado como solo lectura",
            )
        }
        if (desplazamiento + datos.size > tag.memoria.size) {
            throw errorNfc(
                CodigoErrorNfc.INSUFFICIENT_MEMORY,
                "No caben ${datos.size} bytes desde $desplazamiento en ${tag.memoria.size}",
            )
        }
        tag.escribir(desplazamiento, datos)
    }

    override suspend fun transceive(apdu: ByteArray): ByteArray {
        throw errorNfc(
            CodigoErrorNfc.NOT_IMPLEMENTED,
            "El transporte simulado no ejecuta APDUs crudos",
        )
    }

    override suspend fun close() {
        /* nada que cerrar */
    }

    /** Solo para pruebas: marca el tag simulado como solo lectura. */
    fun marcarSoloLectura(valor: Boolean) {
        tag.soloLectura = valor
    }
}
