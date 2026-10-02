package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.core.Registro
import ec.marathon.nfcstudio.domain.model.MEMORIA_USUARIO_BYTES
import ec.marathon.nfcstudio.domain.model.PlanBloqueo
import ec.marathon.nfcstudio.domain.model.TipoChip

/**
 * Proveedor para la familia NTAG 213/215/216 (NFC Forum Type 2 Tag).
 *
 * Port de `packages/nfc-contracts/src/providers/ntag21x.ts` con la escritura
 * real de Android enchufada.
 *
 * QUE HACE ESTE PROVEEDOR
 * -----------------------
 * Escribe un registro NDEF de tipo URI, lo relee y compara. Eso es todo.
 *
 * QUE NO HACE, Y NO PUEDE HACER
 * -----------------------------
 * NO autentica. Una NTAG 21x no ejecuta ninguna operacion criptografica sobre un
 * reto del servidor. Su contenido NDEF es legible y reescribible por cualquier
 * telefono con NFC hasta que se bloquea, y una vez leido puede copiarse a otra
 * etiqueta. El UID es de solo lectura de fabrica, pero existen en el mercado
 * etiquetas con UID escribible y emuladores que lo replican.
 *
 * Por lo tanto: este proveedor NO es un mecanismo anticlonacion. Describirlo
 * como tal en una demo, una nota de prensa o un comentario de codigo seria
 * falso. `canProduceCryptographicProof` es `false` y toda lectura que pase por
 * aqui produce como maximo IDENTIFIED_ONLY.
 *
 * SOBRE LA FIRMA DE ORIGINALIDAD
 * ------------------------------
 * NXP documenta el comando READ_SIG, que devuelve una firma ECC generada en
 * fabrica sobre el UID. Verificarla exige la clave publica de originalidad de
 * NXP, que este repositorio NO incluye y que debe obtenerse del fabricante. Sin
 * esa clave la comprobacion no puede realizarse, y este proveedor lo reporta
 * como `notSupported` en lugar de fingir un resultado.
 *
 * Aunque se verificara, la firma probaria que el SILICIO es de NXP; no probaria
 * que ese chip concreto sea el que Marathon programo ni que siga en su emblema
 * original. Es una senal de riesgo, no una autenticacion.
 */
class Ntag21xNdefProvider(
    private val transport: TagTransport,
    private val detection: TagDetection,
    /**
     * Clave publica de originalidad de NXP. Debe suministrarse por
     * configuracion. Si falta, [validateOriginality] devuelve `notSupported`.
     * NUNCA se versiona en este repositorio.
     *
     * NOTA: esta es una clave PUBLICA de verificacion, no material secreto. No
     * contradice la regla de "ninguna clave en la app": una clave publica no
     * permite firmar nada.
     */
    private val clavePublicaOriginalidadNxp: ByteArray? = null,
) : NfcPersonalizationProvider {

    override val capabilities: ProviderCapabilities = ProviderCapabilities(
        id = IdsProveedor.NTAG21X,
        displayName = "NTAG 213/215/216 - escritura NDEF (solo identificación)",
        supportedChipTypes = TIPOS_NTAG,
        canProduceCryptographicProof = false,
        canVerifyOriginality = false,
        canLockMemory = true,
        isSimulation = false,
        advertencia = "Este chip identifica el producto pero NO lo autentica. " +
            "Su contenido puede copiarse con cualquier teléfono.",
    )

    override suspend fun detectTag(): TagDetection {
        if (detection.chipType !in TIPOS_NTAG) {
            throw errorNfc(
                CodigoErrorNfc.TAG_TYPE_UNSUPPORTED,
                "Este proveedor solo admite NTAG 21x, se detectó ${detection.chipType}",
            )
        }
        return detection
    }

    override suspend fun inspectTag(detection: TagDetection): TagInspection {
        val capacidad = MEMORIA_USUARIO_BYTES[detection.chipType] ?: 0
        if (capacidad == 0) {
            throw errorNfc(
                CodigoErrorNfc.TAG_TYPE_UNSUPPORTED,
                "Capacidad desconocida para ${detection.chipType}",
            )
        }

        // Ruta preferida: la tecnologia Ndef de Android ya nos dice si la
        // etiqueta es escribible SIN tener que escribir nada. Esto evita el
        // sondeo destructivo que hace la version de TypeScript.
        val android = transport as? AndroidTagTransport
        val infoNdef = android?.leerInfoNdef()

        val bytesVersion = android?.obtenerVersion()?.let { NdefCodec.aHex(it) }

        val crudo: ByteArray? = if (infoNdef != null) {
            infoNdef.mensajeActual
        } else {
            runCatching { NdefCodec.desenvolverTlvType2(transport.readUserMemory(0, capacidad)) }
                .getOrElse { error ->
                    throw errorNfc(
                        CodigoErrorNfc.TRANSPORT_ERROR,
                        "No se pudo leer la memoria: ${describirError(error)}",
                        retryable = true,
                    )
                }
        }

        val uriActual = crudo?.let { NdefCodec.decodificarMensajeUriNdef(it) }

        return TagInspection(
            uid = detection.uid,
            chipType = detection.chipType,
            technologies = detection.technologies,
            userMemoryBytes = capacidad,
            // Si la pila NFC no expone Ndef se asume escribible y el fallo, si
            // llega, aparecera en la escritura. Suponer lo contrario impediria
            // trabajar con etiquetas sin formatear.
            readOnly = infoNdef?.escribible?.not() ?: false,
            hasNdefMessage = crudo != null,
            currentUri = uriActual,
            versionBytes = bytesVersion,
        )
    }

    /**
     * No se implementa la verificacion de la firma de originalidad porque exige
     * la clave publica de NXP, que no forma parte de este repositorio. Se
     * reporta con honestidad en lugar de devolver un `verified = true` vacio.
     */
    override suspend fun validateOriginality(detection: TagDetection): OriginalityResult {
        if (clavePublicaOriginalidadNxp == null) {
            return OriginalityResult(
                verified = false,
                notSupported = true,
                simulated = false,
                detail = "Verificación de originalidad no disponible: falta la clave pública " +
                    "de originalidad de NXP. Configúrela para habilitar esta comprobación.",
            )
        }
        // PENDIENTE DE INTEGRACION: emitir READ_SIG por `transceive` y verificar
        // la firma ECDSA sobre el UID con la clave publica configurada. No se
        // implementa a ciegas: requiere validarse contra chips reales.
        return OriginalityResult(
            verified = false,
            notSupported = true,
            simulated = false,
            detail = "Clave pública presente pero la verificación READ_SIG no está " +
                "implementada. Requiere validación contra hardware real antes de habilitarse.",
        )
    }

    override suspend fun preparePersonalization(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): ResultadoPreparacion {
        if (inspection.readOnly) {
            return ResultadoPreparacion(
                ok = false,
                error = infoErrorNfc(
                    CodigoErrorNfc.TAG_READ_ONLY,
                    "El chip ya está bloqueado como solo lectura",
                ),
            )
        }

        // Comprobacion de capacidad ANTES de escribir un solo byte: NTAG213=144,
        // NTAG215=504, NTAG216=888 bytes de memoria de usuario. Una escritura
        // truncada deja el chip inservible con el emblema ya cosido.
        val capacidad = NdefCodec.comprobarQueLaUriCabe(plan.uri, inspection.chipType)
        if (!capacidad.cabe) {
            return ResultadoPreparacion(
                ok = false,
                error = infoErrorNfc(
                    CodigoErrorNfc.INSUFFICIENT_MEMORY,
                    "La URI requiere ${capacidad.bytesRequeridos} bytes y el chip ofrece " +
                        "${capacidad.bytesDisponibles}",
                ),
            )
        }

        if (plan.keyReferences.isNotEmpty()) {
            // Defensa en profundidad: si alguien encola un plan con referencias
            // de clave sobre un chip que no las soporta, se rechaza en lugar de
            // ignorarlas en silencio y dar la operacion por buena.
            return ResultadoPreparacion(
                ok = false,
                error = infoErrorNfc(
                    CodigoErrorNfc.OPERATION_NOT_PERMITTED,
                    "El plan incluye referencias de clave, pero una NTAG 21x no admite " +
                        "personalización criptográfica",
                ),
            )
        }

        return ResultadoPreparacion(ok = true)
    }

    override suspend fun writeNdef(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): WriteResult {
        val preparado = preparePersonalization(inspection, plan)
        if (!preparado.ok) {
            return WriteResult(false, 0, "", preparado.error)
        }

        val mensaje = NdefCodec.codificarMensajeUriNdef(plan.uri)
        val payloadConTlv = NdefCodec.envolverTlvType2(mensaje)
        val android = transport as? AndroidTagTransport

        return try {
            if (android != null && android.soportaNdef()) {
                // Ruta de alto nivel: la plataforma escribe el TLV y actualiza el
                // bloque de capacidad. Los bytes que se registran en auditoria
                // son los del MENSAJE, porque el TLV lo construye Android.
                android.escribirMensajeNdef(mensaje)
                WriteResult(
                    success = true,
                    bytesWritten = mensaje.size,
                    writtenPayloadHex = NdefCodec.aHex(mensaje),
                )
            } else {
                // Respaldo crudo por NfcA para etiquetas que no exponen Ndef.
                transport.writeUserMemory(0, payloadConTlv)
                WriteResult(
                    success = true,
                    bytesWritten = payloadConTlv.size,
                    writtenPayloadHex = NdefCodec.aHex(payloadConTlv),
                )
            }
        } catch (error: NfcOperationException) {
            WriteResult(false, 0, "", error.info)
        } catch (error: Exception) {
            WriteResult(
                success = false,
                bytesWritten = 0,
                writtenPayloadHex = "",
                error = infoErrorNfc(
                    CodigoErrorNfc.WRITE_FAILED,
                    "Falló la escritura: ${describirError(error)}",
                    retryable = true,
                ),
            )
        }
    }

    /** Una NTAG 21x no tiene nada que personalizar criptograficamente. */
    override suspend fun personalizeSecureTag(
        inspection: TagInspection,
        plan: PersonalizationPlan,
    ): WriteResult = WriteResult(
        success = false,
        bytesWritten = 0,
        writtenPayloadHex = "",
        error = infoErrorNfc(
            CodigoErrorNfc.OPERATION_NOT_PERMITTED,
            "NTAG 21x no admite personalización criptográfica. Use un NTAG 424 DNA.",
        ),
    )

    /**
     * Relectura y comparacion. Es el paso que convierte "la escritura devolvio
     * exito" en "el chip contiene lo que debe contener". Sin esto, un fallo de
     * radio a mitad de escritura pasaria por bueno.
     */
    override suspend fun verifyPersonalization(
        inspection: TagInspection,
        plan: PersonalizationPlan,
        write: WriteResult,
    ): VerifyPersonalizationResult {
        val android = transport as? AndroidTagTransport

        val mensaje: ByteArray? = try {
            if (android != null && android.soportaNdef()) {
                android.leerMensajeNdef()
            } else {
                NdefCodec.desenvolverTlvType2(
                    transport.readUserMemory(0, inspection.userMemoryBytes),
                )
            }
        } catch (error: Exception) {
            return VerifyPersonalizationResult(
                matches = false,
                readBackUri = null,
                detail = "No se pudo releer el chip: ${describirError(error)}",
            )
        }

        val uriReleida = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }
        val coincide = uriReleida == plan.uri

        if (!coincide) {
            Registro.advertencia(
                ETIQUETA,
                "Relectura distinta de lo grabado para el trabajo ${plan.jobId}.",
            )
        }

        return VerifyPersonalizationResult(
            matches = coincide,
            readBackUri = uriReleida,
            detail = if (coincide) {
                "La relectura coincide con lo grabado"
            } else {
                "La relectura no coincide. Se esperaba un registro URI y se leyó: " +
                    (uriReleida ?: "ninguno")
            },
        )
    }

    /**
     * Bloqueo del area NDEF.
     *
     * NO IMPLEMENTADO A PROPOSITO. Escribir los lock bytes o los bits de
     * configuracion de un NTAG 21x es IRREVERSIBLE: un error de offset
     * inutiliza el chip de forma permanente, y aqui no hay hardware con el que
     * validar el offset de cada familia.
     *
     * Android expone `Ndef.makeReadOnly()`, que seria la via correcta y segura
     * para `bloquearNdefSoloLectura`; NO se usa todavia porque tambien es
     * irreversible y el flujo de confirmacion explicita con el operario no se
     * ha podido ensayar en planta. Queda como el primer punto de integracion
     * cuando haya chips de prueba.
     */
    override suspend fun lockAllowedAreas(
        inspection: TagInspection,
        lockPlan: PlanBloqueo,
    ): WriteResult {
        if (!lockPlan.exigeAlgo) {
            return WriteResult(success = true, bytesWritten = 0, writtenPayloadHex = "")
        }
        return WriteResult(
            success = false,
            bytesWritten = 0,
            writtenPayloadHex = "",
            error = infoErrorNfc(
                CodigoErrorNfc.NOT_IMPLEMENTED,
                "El bloqueo irreversible de NTAG 21x no está implementado: requiere " +
                    "validación con hardware real.",
            ),
        )
    }

    override suspend fun readVerificationPayload(detection: TagDetection): VerificationPayload {
        val android = transport as? AndroidTagTransport
        val mensaje = if (android != null && android.soportaNdef()) {
            android.leerMensajeNdef()
        } else {
            val capacidad = MEMORIA_USUARIO_BYTES[detection.chipType] ?: 144
            NdefCodec.desenvolverTlvType2(transport.readUserMemory(0, capacidad))
        }
        val uri = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }

        return VerificationPayload(
            token = uri?.substringAfterLast('/')?.takeIf { it.isNotEmpty() },
            // Una NTAG 21x no produce mensajes autenticados. Siempre null.
            authenticatedMessage = null,
            // Tampoco expone un contador de lecturas en el payload NDEF.
            readCounter = null,
            simulated = false,
            uri = uri,
        )
    }

    override suspend fun runPostPressCheck(
        detection: TagDetection,
        expectedUri: String,
    ): PostPressResult = try {
        val android = transport as? AndroidTagTransport
        val mensaje = if (android != null && android.soportaNdef()) {
            android.leerMensajeNdef()
        } else {
            val capacidad = MEMORIA_USUARIO_BYTES[detection.chipType] ?: 144
            NdefCodec.desenvolverTlvType2(transport.readUserMemory(0, capacidad))
        }
        val uri = mensaje?.let { NdefCodec.decodificarMensajeUriNdef(it) }
        PostPressResult(
            readable = mensaje != null,
            contentIntact = uri == expectedUri,
            // Android no expone RSSI para NFC. Se deja null en lugar de inventarlo.
            signalStrength = null,
            detail = when {
                mensaje == null -> "El chip respondió pero no contiene un mensaje NDEF válido"
                uri == expectedUri -> "Contenido intacto tras el termosellado"
                else -> "El contenido cambió tras el termosellado"
            },
        )
    } catch (error: Exception) {
        PostPressResult(
            readable = false,
            contentIntact = false,
            signalStrength = null,
            detail = "El chip no respondió tras el termosellado: ${describirError(error)}",
        )
    }

    private companion object {
        const val ETIQUETA = "Ntag21x"
        val TIPOS_NTAG = listOf(TipoChip.NTAG213, TipoChip.NTAG215, TipoChip.NTAG216)
    }
}
