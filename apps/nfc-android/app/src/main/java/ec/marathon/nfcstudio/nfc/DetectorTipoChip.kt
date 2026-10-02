package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.domain.model.TipoChip

/**
 * Identificacion de la familia del chip.
 *
 * Se intentan dos vias, en este orden y con este motivo:
 *
 *  1. GET_VERSION (0x60). La hoja de datos publica de NXP para la familia
 *     NTAG 21x documenta una respuesta de 8 bytes donde el septimo
 *     (indice 6, "storage size") identifica el producto:
 *       0x0F -> NTAG213, 0x11 -> NTAG215, 0x13 -> NTAG216.
 *     Es la via directa, pero NO se ha podido comprobar contra chips reales en
 *     este entorno (ver README, "Qué NO está probado").
 *
 *  2. Capacidad del area NDEF que reporta `android.nfc.tech.Ndef.getMaxSize()`.
 *     Para estas tres familias coincide con la memoria de usuario: 144 / 504 /
 *     888 bytes. Es una inferencia, no una identificacion: una etiqueta de otro
 *     fabricante con la misma capacidad daria el mismo resultado.
 *
 * Si ninguna via concluye se devuelve [TipoChip.UNKNOWN]. NO se adivina: un
 * chip mal identificado lleva a escribir mas bytes de los que caben.
 */
object DetectorTipoChip {

    private const val INDICE_TAMANO_ALMACENAMIENTO = 6

    private val PRODUCTOS_POR_TAMANO: Map<Int, TipoChip> = mapOf(
        0x0F to TipoChip.NTAG213,
        0x11 to TipoChip.NTAG215,
        0x13 to TipoChip.NTAG216,
    )

    private val TIPOS_POR_CAPACIDAD_NDEF: Map<Int, TipoChip> = mapOf(
        144 to TipoChip.NTAG213,
        504 to TipoChip.NTAG215,
        888 to TipoChip.NTAG216,
    )

    suspend fun detectar(transporte: AndroidTagTransport): TipoChip {
        porVersion(transporte)?.let { return it }
        porCapacidadNdef(transporte)?.let { return it }
        Registro.advertencia(
            ETIQUETA,
            "No se pudo identificar la familia del chip por ninguna de las dos vías.",
        )
        return TipoChip.UNKNOWN
    }

    /** Via 1: GET_VERSION. */
    suspend fun porVersion(transporte: AndroidTagTransport): TipoChip? {
        val version = transporte.obtenerVersion() ?: return null
        if (version.size <= INDICE_TAMANO_ALMACENAMIENTO) return null
        val tamano = version[INDICE_TAMANO_ALMACENAMIENTO].toInt() and 0xFF
        val tipo = PRODUCTOS_POR_TAMANO[tamano]
        if (tipo == null) {
            Registro.depuracion(
                ETIQUETA,
                "GET_VERSION respondió con un tamaño de almacenamiento no catalogado.",
            )
        }
        return tipo
    }

    /** Via 2: capacidad del area NDEF. Inferencia, no identificacion. */
    suspend fun porCapacidadNdef(transporte: AndroidTagTransport): TipoChip? {
        val info = transporte.leerInfoNdef() ?: return null
        val tipo = TIPOS_POR_CAPACIDAD_NDEF[info.capacidadMaxima]
        if (tipo != null) {
            Registro.depuracion(
                ETIQUETA,
                "Familia inferida por capacidad NDEF (${info.capacidadMaxima} bytes). " +
                    "Es una inferencia, no una identificación.",
            )
        }
        return tipo
    }

    private const val ETIQUETA = "DetectorChip"
}

/**
 * Fabrica del proveedor adecuado para un chip concreto.
 *
 * Centralizarla evita que una pantalla elija el proveedor "a mano" y acabe
 * usando el simulador en produccion o el proveedor real en una formacion.
 */
object FabricaProveedores {

    /**
     * @param modoSimulacion cuando es `true` se devuelve SIEMPRE el simulador,
     *   independientemente del chip y del proveedor que pida el servidor.
     * @param proveedorSolicitado identificador que el servidor indico en el plan
     *   de trabajo. Si no coincide con lo que este telefono puede ejecutar, se
     *   devuelve null y la pantalla lo comunica en lugar de improvisar.
     */
    fun crear(
        modoSimulacion: Boolean,
        proveedorSolicitado: String?,
        transporte: AndroidTagTransport?,
        deteccion: TagDetection?,
    ): NfcPersonalizationProvider? {
        if (modoSimulacion) {
            val tipo = deteccion?.chipType ?: TipoChip.NTAG213
            return MockNfcProvider.paraTipo(tipo, deteccion?.uid ?: "04A1B2C3D4E580")
        }
        if (transporte == null || deteccion == null) return null

        return when (proveedorSolicitado) {
            IdsProveedor.NTAG21X, null -> Ntag21xNdefProvider(transporte, deteccion)
            IdsProveedor.NTAG424 -> Ntag424DnaProvider(transporte, deteccion)
            IdsProveedor.SIMULADO -> MockNfcProvider.paraTipo(deteccion.chipType, deteccion.uid)
            else -> null
        }
    }
}
