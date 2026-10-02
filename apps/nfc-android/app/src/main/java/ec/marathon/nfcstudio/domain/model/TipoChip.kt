package ec.marathon.nfcstudio.domain.model

/**
 * Familias de chip soportadas o contempladas.
 * Portado de CHIP_TYPES en `packages/domain/src/trust.ts`.
 */
enum class TipoChip {
    NTAG213,
    NTAG215,
    NTAG216,

    /** Soporta SUN (Secure Unique NFC) message con CMAC. Integracion pendiente. */
    NTAG424DNA,

    /** Chip detectado pero no reconocido por el catalogo. */
    UNKNOWN,
    ;

    val etiquetaOperario: String
        get() = when (this) {
            NTAG213 -> "Emblema estándar (213)"
            NTAG215 -> "Emblema ampliado (215)"
            NTAG216 -> "Emblema ampliado (216)"
            NTAG424DNA -> "Emblema seguro (424 DNA)"
            UNKNOWN -> "Chip no reconocido"
        }

    companion object {
        fun desdeApi(valor: String?): TipoChip =
            entries.firstOrNull { it.name.equals(valor, ignoreCase = true) } ?: UNKNOWN
    }
}

/**
 * Indica si una familia de chip es capaz, POR DISENO DEL SILICIO, de producir
 * una prueba criptografica verificable en servidor.
 *
 * NTAG 21x no lo es. Es una propiedad del hardware, no una configuracion, y por
 * eso esta funcion no admite parametros ni banderas que la relajen.
 *
 * OJO: que el silicio sea capaz no significa que esta app lo sea. La capacidad
 * efectiva la declara el proveedor en `canProduceCryptographicProof`, que hoy
 * es `false` en los tres proveedores.
 */
fun soportaAutenticacionCriptografica(tipo: TipoChip): Boolean = tipo == TipoChip.NTAG424DNA

/**
 * Memoria de usuario por familia, en bytes.
 *
 * Valores de las hojas de datos publicas de NXP, identicos a
 * NTAG_USER_MEMORY_BYTES en `packages/nfc-contracts/src/ndef.ts`. Es la memoria
 * de USUARIO (paginas 4..N), no la memoria total del chip.
 */
val MEMORIA_USUARIO_BYTES: Map<TipoChip, Int> = mapOf(
    TipoChip.NTAG213 to 144,
    TipoChip.NTAG215 to 504,
    TipoChip.NTAG216 to 888,
)
