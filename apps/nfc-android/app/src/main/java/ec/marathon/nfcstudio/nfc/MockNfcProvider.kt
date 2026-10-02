package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.domain.model.MEMORIA_USUARIO_BYTES
import ec.marathon.nfcstudio.domain.model.PlanBloqueo
import ec.marathon.nfcstudio.domain.model.TipoChip
import kotlinx.coroutines.delay

/**
 * ############################################################################
 * # PROVEEDOR SIMULADO - NO PRODUCE AUTENTICACION REAL                       #
 * ############################################################################
 *
 * Port de `packages/nfc-contracts/src/providers/mock.ts`.
 *
 * Este proveedor NO habla con ningun chip. Existe para dos cosas concretas:
 *  1. Formar operarios nuevos sin gastar inventario ni ocupar un puesto.
 *  2. Desarrollar y probar toda la cadena (app -> API -> base de datos -> web)
 *     en telefonos sin antena NFC.
 *
 * Todo payload que emite lleva `simulated = true`. El motor de riesgo del
 * servidor trata esa marca como regla dura: una evidencia simulada JAMAS produce
 * el nivel VERIFIED. La interfaz, por su parte, muestra un banner permanente de
 * SIMULACION mientras este proveedor este activo (ver `BannerSimulacion`), para
 * que nadie confunda una practica con produccion real.
 */
class MockNfcProvider(
    private val opciones: OpcionesSimulador = OpcionesSimulador(),
) : NfcPersonalizationProvider {

    /**
     * Opciones para forzar los fallos que en planta ocurren de verdad. Sirven
     * tanto para las pruebas unitarias como para el modo formacion: el
     * supervisor puede provocar un fallo y ver como reacciona el operario.
     */
    data class OpcionesSimulador(
        val tag: TagSimulado = TagSimulado.crear(),
        /** Fuerza un fallo en la escritura, para ejercitar los reintentos. */
        val fallarEscritura: Boolean = false,
        /** Fuerza que la relectura no coincida, para ejercitar la cuarentena. */
        val corromperAlVerificar: Boolean = false,
        /** Simula que el chip deja de responder tras el termosellado. */
        val fallarTrasTermosellado: Boolean = false,
        /** Retardo artificial por operacion, para que la UI no parezca instantanea. */
        val retardoMs: Long = 0L,
    )

    override val capabilities: ProviderCapabilities = ProviderCapabilities(
        id = IdsProveedor.SIMULADO,
        displayName = "Simulador NFC (NO es autenticación real)",
        supportedChipTypes = listOf(
            TipoChip.NTAG213, TipoChip.NTAG215, TipoChip.NTAG216,
            TipoChip.NTAG424DNA, TipoChip.UNKNOWN,
        ),
        // Deliberadamente `false`: un simulador no puede producir una prueba.
        canProduceCryptographicProof = false,
        canVerifyOriginality = false,
        canLockMemory = true,
        isSimulation = true,
        advertencia = "SIMULACIÓN: no hay hardware involucrado. Ningún resultado de esta " +
            "pantalla constituye autenticación ni cuenta como producción real.",
    )

    private val tag: TagSimulado = opciones.tag
    private val transporte = TransporteSimulado(tag)

    override suspend fun detectTag(): TagDetection {
        esperar()
        return TagDetection(
            uid = tag.uid,
            chipType = tag.tipoChip,
            technologies = listOf("SIMULATED"),
        )
    }

    override suspend fun inspectTag(detection: TagDetection): TagInspection {
        esperar()
        val tlv = transporte.readUserMemory(0, tag.memoria.size)
        val mensaje = NdefCodec.desenvolverTlvType2(tlv)
        val uri = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }
        return TagInspection(
            uid = detection.uid,
            chipType = detection.chipType,
            technologies = detection.technologies,
            userMemoryBytes = tag.memoria.size,
            readOnly = tag.soloLectura,
            hasNdefMessage = mensaje != null,
            currentUri = uri,
            versionBytes = null,
        )
    }

    override suspend fun validateOriginality(detection: TagDetection): OriginalityResult {
        esperar()
        return OriginalityResult(
            verified = false,
            notSupported = true,
            simulated = true,
            detail = "SIMULACIÓN: no se comprobó ninguna firma de originalidad. Este " +
                "resultado no constituye evidencia de que el silicio sea auténtico.",
        )
    }

    override suspend fun preparePersonalization(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): ResultadoPreparacion {
        esperar()
        if (inspection.readOnly) {
            return ResultadoPreparacion(
                ok = false,
                error = infoErrorNfc(
                    CodigoErrorNfc.TAG_READ_ONLY,
                    "El chip simulado ya está bloqueado",
                ),
            )
        }
        val requeridos = NdefCodec.envolverTlvType2(NdefCodec.codificarMensajeUriNdef(plan.uri)).size
        if (requeridos > inspection.userMemoryBytes) {
            return ResultadoPreparacion(
                ok = false,
                error = infoErrorNfc(
                    CodigoErrorNfc.INSUFFICIENT_MEMORY,
                    "Requiere $requeridos bytes, disponibles ${inspection.userMemoryBytes}",
                ),
            )
        }
        return ResultadoPreparacion(ok = true)
    }

    override suspend fun writeNdef(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): WriteResult {
        esperar()
        if (opciones.fallarEscritura) {
            return WriteResult(
                success = false,
                bytesWritten = 0,
                writtenPayloadHex = "",
                error = infoErrorNfc(
                    CodigoErrorNfc.WRITE_FAILED,
                    "SIMULACIÓN: fallo de escritura forzado",
                    retryable = true,
                ),
            )
        }
        val payload = NdefCodec.envolverTlvType2(NdefCodec.codificarMensajeUriNdef(plan.uri))
        return try {
            transporte.writeUserMemory(0, payload)
            WriteResult(
                success = true,
                bytesWritten = payload.size,
                writtenPayloadHex = NdefCodec.aHex(payload),
            )
        } catch (error: NfcOperationException) {
            WriteResult(
                success = false,
                bytesWritten = 0,
                writtenPayloadHex = "",
                error = error.info,
            )
        }
    }

    /**
     * En el simulador esto es exactamente lo mismo que [writeNdef]: NO hay
     * diversificacion de claves, NO hay configuracion SUN, NO hay criptografia.
     * Se deja explicito para que nadie lo lea como "aqui si pasa algo seguro".
     */
    override suspend fun personalizeSecureTag(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): WriteResult = writeNdef(inspection, plan)

    override suspend fun verifyPersonalization(
        inspection: TagInspection,
        plan: PersonalizationPlan,
        write: WriteResult,
    ): VerifyPersonalizationResult {
        esperar()
        if (opciones.corromperAlVerificar) {
            return VerifyPersonalizationResult(
                matches = false,
                readBackUri = null,
                detail = "SIMULACIÓN: relectura corrupta forzada",
            )
        }
        val tlv = transporte.readUserMemory(0, tag.memoria.size)
        val mensaje = NdefCodec.desenvolverTlvType2(tlv)
        val uriReleida = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }
        val coincide = uriReleida == plan.uri
        return VerifyPersonalizationResult(
            matches = coincide,
            readBackUri = uriReleida,
            detail = if (coincide) "Relectura coincide" else "Relectura NO coincide",
        )
    }

    override suspend fun lockAllowedAreas(
        inspection: TagInspection,
        lockPlan: PlanBloqueo,
    ): WriteResult {
        esperar()
        if (lockPlan.bloquearNdefSoloLectura) tag.soloLectura = true
        if (lockPlan.bloquearConfiguracion) tag.configuracionBloqueada = true
        return WriteResult(success = true, bytesWritten = 0, writtenPayloadHex = "")
    }

    override suspend fun readVerificationPayload(detection: TagDetection): VerificationPayload {
        esperar()
        val tlv = transporte.readUserMemory(0, tag.memoria.size)
        val mensaje = NdefCodec.desenvolverTlvType2(tlv)
        val uri = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }
        tag.contadorLecturas += 1
        return VerificationPayload(
            token = uri?.substringAfterLast('/')?.takeIf { it.isNotEmpty() },
            // Deliberadamente null: un simulador no fabrica mensajes autenticados.
            authenticatedMessage = null,
            readCounter = tag.contadorLecturas,
            simulated = true,
            uri = uri,
        )
    }

    override suspend fun runPostPressCheck(
        detection: TagDetection,
        expectedUri: String,
    ): PostPressResult {
        esperar()
        if (opciones.fallarTrasTermosellado) {
            return PostPressResult(
                readable = false,
                contentIntact = false,
                signalStrength = null,
                detail = "SIMULACIÓN: el chip no responde tras el termosellado",
            )
        }
        val tlv = transporte.readUserMemory(0, tag.memoria.size)
        val mensaje = NdefCodec.desenvolverTlvType2(tlv)
        val uri = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }
        return PostPressResult(
            readable = mensaje != null,
            contentIntact = uri == expectedUri,
            // Android no expone intensidad de senal para NFC. Null, no inventado.
            signalStrength = null,
            detail = when {
                mensaje == null -> "El chip respondió pero no contiene un mensaje NDEF válido"
                uri == expectedUri -> "Contenido intacto tras el termosellado (simulado)"
                else -> "El contenido cambió tras el termosellado (simulado)"
            },
        )
    }

    /** Acceso al tag simulado, solo para pruebas y para el modo formacion. */
    fun tagSimulado(): TagSimulado = tag

    private suspend fun esperar() {
        if (opciones.retardoMs > 0) delay(opciones.retardoMs)
    }

    companion object {
        /** Crea un simulador con la capacidad correcta para el tipo indicado. */
        fun paraTipo(tipo: TipoChip, uid: String = "04A1B2C3D4E580"): MockNfcProvider {
            val tamano = MEMORIA_USUARIO_BYTES[tipo] ?: 144
            return MockNfcProvider(
                OpcionesSimulador(tag = TagSimulado(uid, tipo, tamano)),
            )
        }
    }
}
