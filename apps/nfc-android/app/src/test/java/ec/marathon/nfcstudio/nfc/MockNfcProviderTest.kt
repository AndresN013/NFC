package ec.marathon.nfcstudio.nfc

import ec.marathon.nfcstudio.domain.model.PlanBloqueo
import ec.marathon.nfcstudio.domain.model.TipoChip
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pruebas del proveedor simulado.
 *
 * Además de comprobar que el ciclo funciona, estas pruebas FIJAN LAS GARANTÍAS DE
 * SEGURIDAD del simulador:
 *
 *  - `isSimulation` es siempre `true`.
 *  - `canProduceCryptographicProof` es siempre `false`.
 *  - todo payload de verificación sale con `simulated = true`.
 *  - `authenticatedMessage` es siempre `null`.
 *
 * Si alguien cambiara cualquiera de esas cuatro cosas para "que la demo quede
 * mejor", estas pruebas fallan. Ese es exactamente su propósito: el motor de
 * riesgo del servidor usa esas banderas para negarse a emitir el nivel VERIFIED.
 */
class MockNfcProviderTest {

    private fun plan(
        uri: String = "https://escudo-vivo.marathon.ec/v/PRUEBA123",
        bloqueo: PlanBloqueo = PlanBloqueo(false, false),
    ) = PersonalizationPlan(
        jobId = "trabajo-1",
        uri = uri,
        keyReferences = emptyList(),
        lockPlan = bloqueo,
    )

    // --- Capacidades declaradas ---------------------------------------------

    @Test
    fun `el simulador se declara como simulacion y sin prueba criptografica`() {
        val capacidades = MockNfcProvider().capabilities
        assertTrue(capacidades.isSimulation, "un simulador SIEMPRE debe declararse como tal")
        assertFalse(
            capacidades.canProduceCryptographicProof,
            "un simulador no puede producir una prueba criptográfica",
        )
        assertFalse(capacidades.canVerifyOriginality)
        assertEquals(IdsProveedor.SIMULADO, capacidades.id)
        assertNotNull(capacidades.advertencia)
        assertTrue(capacidades.advertencia!!.contains("SIMULACIÓN"))
    }

    // --- Ciclo completo -----------------------------------------------------

    @Test
    fun `ciclo completo correcto de principio a fin`() = runTest {
        val proveedor = MockNfcProvider()
        val plan = plan()

        // 1. Detección
        val deteccion = proveedor.detectTag()
        assertEquals(TipoChip.NTAG213, deteccion.chipType)
        assertEquals(listOf("SIMULATED"), deteccion.technologies)

        // 2. Inspección: el chip está en blanco
        val inspeccion = proveedor.inspectTag(deteccion)
        assertEquals(144, inspeccion.userMemoryBytes)
        assertFalse(inspeccion.readOnly)
        assertFalse(inspeccion.hasNdefMessage)
        assertNull(inspeccion.currentUri)

        // 3. Originalidad: no soportada y declarada como simulada
        val originalidad = proveedor.validateOriginality(deteccion)
        assertFalse(originalidad.verified)
        assertTrue(originalidad.notSupported)
        assertTrue(originalidad.simulated)

        // 4. Preparación
        assertTrue(proveedor.preparePersonalization(inspeccion, plan).ok)

        // 5. Escritura
        val escritura = proveedor.writeNdef(inspeccion, plan)
        assertTrue(escritura.success)
        assertNull(escritura.error)
        assertTrue(escritura.bytesWritten > 0)
        // Lo que dice haber escrito debe ser exactamente el TLV del mensaje.
        val esperado = NdefCodec.envolverTlvType2(NdefCodec.codificarMensajeUriNdef(plan.uri))
        assertEquals(NdefCodec.aHex(esperado), escritura.writtenPayloadHex)
        assertEquals(esperado.size, escritura.bytesWritten)

        // 6. Relectura
        val verificacion = proveedor.verifyPersonalization(inspeccion, plan, escritura)
        assertTrue(verificacion.matches)
        assertEquals(plan.uri, verificacion.readBackUri)

        // 7. Una nueva inspección ya ve el contenido
        val segundaInspeccion = proveedor.inspectTag(deteccion)
        assertTrue(segundaInspeccion.hasNdefMessage)
        assertEquals(plan.uri, segundaInspeccion.currentUri)

        // 8. Control posterior al termosellado
        val postPrensa = proveedor.runPostPressCheck(deteccion, plan.uri)
        assertTrue(postPrensa.readable)
        assertTrue(postPrensa.contentIntact)
        // Android no expone intensidad de señal para NFC: null, no inventada.
        assertNull(postPrensa.signalStrength)
    }

    // --- Fallo de escritura -------------------------------------------------

    @Test
    fun `un fallo de escritura forzado se reporta como reintentable y no altera el chip`() = runTest {
        val proveedor = MockNfcProvider(
            MockNfcProvider.OpcionesSimulador(fallarEscritura = true),
        )
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)

        val escritura = proveedor.writeNdef(inspeccion, plan())

        assertFalse(escritura.success)
        assertEquals(0, escritura.bytesWritten)
        assertEquals("", escritura.writtenPayloadHex)
        assertEquals(CodigoErrorNfc.WRITE_FAILED, escritura.error?.code)
        assertTrue(escritura.error!!.retryable, "un fallo de grabación debe poder reintentarse")
        assertEquals(
            MENSAJES_OPERARIO_NFC.getValue(CodigoErrorNfc.WRITE_FAILED),
            escritura.error!!.operatorMessage,
        )

        // El chip sigue en blanco: no se escribió nada a medias.
        assertFalse(proveedor.inspectTag(deteccion).hasNdefMessage)
    }

    // --- Relectura corrupta -------------------------------------------------

    @Test
    fun `una relectura corrupta no coincide y no devuelve uri`() = runTest {
        val proveedor = MockNfcProvider(
            MockNfcProvider.OpcionesSimulador(corromperAlVerificar = true),
        )
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        val plan = plan()

        val escritura = proveedor.writeNdef(inspeccion, plan)
        assertTrue(escritura.success)

        val verificacion = proveedor.verifyPersonalization(inspeccion, plan, escritura)
        assertFalse(verificacion.matches, "la relectura corrupta NO debe darse por buena")
        assertNull(verificacion.readBackUri)
        assertTrue(verificacion.detail.contains("SIMULACIÓN"))
    }

    @Test
    fun `una memoria destrozada por el calor se detecta en la relectura`() = runTest {
        val tag = TagSimulado.crear()
        val proveedor = MockNfcProvider(MockNfcProvider.OpcionesSimulador(tag = tag))
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        val plan = plan()

        proveedor.writeNdef(inspeccion, plan)
        // La prensa arruina el contenido.
        tag.corromperMemoria()

        val postPrensa = proveedor.runPostPressCheck(deteccion, plan.uri)
        assertFalse(postPrensa.contentIntact)
        assertFalse(postPrensa.readable)
    }

    @Test
    fun `un contenido distinto del esperado se detecta tras la prensa`() = runTest {
        val proveedor = MockNfcProvider()
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        val plan = plan()
        proveedor.writeNdef(inspeccion, plan)

        // Se comprueba contra OTRA uri: el chip es legible pero no es el esperado,
        // que es el caso de un emblema cruzado entre dos unidades.
        val postPrensa = proveedor.runPostPressCheck(
            deteccion,
            "https://escudo-vivo.marathon.ec/v/OTRA",
        )
        assertTrue(postPrensa.readable)
        assertFalse(postPrensa.contentIntact)
    }

    @Test
    fun `un chip que deja de responder tras la prensa se reporta ilegible`() = runTest {
        val proveedor = MockNfcProvider(
            MockNfcProvider.OpcionesSimulador(fallarTrasTermosellado = true),
        )
        val deteccion = proveedor.detectTag()
        val postPrensa = proveedor.runPostPressCheck(deteccion, "https://marathon.ec/v/AB")
        assertFalse(postPrensa.readable)
        assertFalse(postPrensa.contentIntact)
    }

    // --- Chip bloqueado y capacidad ----------------------------------------

    @Test
    fun `un chip bloqueado rechaza la preparacion`() = runTest {
        val tag = TagSimulado.crear().apply { soloLectura = true }
        val proveedor = MockNfcProvider(MockNfcProvider.OpcionesSimulador(tag = tag))
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)

        assertTrue(inspeccion.readOnly)

        val preparacion = proveedor.preparePersonalization(inspeccion, plan())
        assertFalse(preparacion.ok)
        assertEquals(CodigoErrorNfc.TAG_READ_ONLY, preparacion.error?.code)
        assertFalse(preparacion.error!!.retryable, "un chip bloqueado no se arregla reintentando")
    }

    @Test
    fun `una uri que no cabe se rechaza antes de escribir`() = runTest {
        val proveedor = MockNfcProvider.paraTipo(TipoChip.NTAG213)
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)

        val planGrande = plan(uri = "https://escudo-vivo.marathon.ec/v/" + "X".repeat(200))
        val preparacion = proveedor.preparePersonalization(inspeccion, planGrande)

        assertFalse(preparacion.ok)
        assertEquals(CodigoErrorNfc.INSUFFICIENT_MEMORY, preparacion.error?.code)
        // Y el chip sigue intacto: la comprobación es previa a cualquier escritura.
        assertFalse(proveedor.inspectTag(deteccion).hasNdefMessage)
    }

    @Test
    fun `las familias mas grandes admiten la uri que no cabe en una NTAG213`() = runTest {
        val uriLarga = "https://escudo-vivo.marathon.ec/v/" + "X".repeat(200)
        for (tipo in listOf(TipoChip.NTAG215, TipoChip.NTAG216)) {
            val proveedor = MockNfcProvider.paraTipo(tipo)
            val deteccion = proveedor.detectTag()
            val inspeccion = proveedor.inspectTag(deteccion)
            assertTrue(
                proveedor.preparePersonalization(inspeccion, plan(uri = uriLarga)).ok,
                "$tipo debería admitir la uri larga",
            )
        }
    }

    // --- Bloqueo ------------------------------------------------------------

    @Test
    fun `el bloqueo simulado deja el chip en solo lectura`() = runTest {
        val proveedor = MockNfcProvider()
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        proveedor.writeNdef(inspeccion, plan())

        val bloqueo = proveedor.lockAllowedAreas(
            inspeccion,
            PlanBloqueo(bloquearNdefSoloLectura = true, bloquearConfiguracion = true),
        )
        assertTrue(bloqueo.success)

        val despues = proveedor.inspectTag(deteccion)
        assertTrue(despues.readOnly)
        assertTrue(proveedor.tagSimulado().configuracionBloqueada)

        // Y ya no admite otra escritura.
        assertFalse(proveedor.writeNdef(despues, plan()).success)
    }

    // --- Payload de verificación --------------------------------------------

    @Test
    fun `el payload de verificacion siempre va marcado como simulado y sin firma`() = runTest {
        val proveedor = MockNfcProvider()
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        val plan = plan()
        proveedor.writeNdef(inspeccion, plan)

        val payload = proveedor.readVerificationPayload(deteccion)

        assertTrue(payload.simulated, "el payload simulado DEBE declararse simulado")
        assertNull(
            payload.authenticatedMessage,
            "un simulador no fabrica mensajes autenticados",
        )
        assertEquals("PRUEBA123", payload.token)
        assertEquals(plan.uri, payload.uri)
    }

    @Test
    fun `el contador de lecturas simulado avanza en cada lectura`() = runTest {
        val proveedor = MockNfcProvider()
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        proveedor.writeNdef(inspeccion, plan())

        assertEquals(1, proveedor.readVerificationPayload(deteccion).readCounter)
        assertEquals(2, proveedor.readVerificationPayload(deteccion).readCounter)
        assertEquals(3, proveedor.readVerificationPayload(deteccion).readCounter)
    }

    @Test
    fun `leer un chip en blanco no devuelve token`() = runTest {
        val proveedor = MockNfcProvider()
        val deteccion = proveedor.detectTag()
        val payload = proveedor.readVerificationPayload(deteccion)
        assertNull(payload.token)
        assertNull(payload.uri)
        assertTrue(payload.simulated)
    }

    // --- personalizeSecureTag ----------------------------------------------

    @Test
    fun `personalizar de forma segura en el simulador es solo una escritura NDEF`() = runTest {
        // Se comprueba explícitamente que NO hay nada criptográfico detrás: el
        // resultado es idéntico al de writeNdef. Documentado como prueba para que
        // nadie interprete el nombre del método como una garantía.
        val proveedor = MockNfcProvider()
        val deteccion = proveedor.detectTag()
        val inspeccion = proveedor.inspectTag(deteccion)
        val plan = plan()

        val seguro = proveedor.personalizeSecureTag(inspeccion, plan)
        assertTrue(seguro.success)

        val esperado = NdefCodec.envolverTlvType2(NdefCodec.codificarMensajeUriNdef(plan.uri))
        assertEquals(NdefCodec.aHex(esperado), seguro.writtenPayloadHex)
        assertNull(proveedor.readVerificationPayload(deteccion).authenticatedMessage)
    }

    // --- Transporte simulado ------------------------------------------------

    @Test
    fun `el transporte simulado rechaza apdus crudos`() = runTest {
        val transporte = TransporteSimulado(TagSimulado.crear())
        val error = kotlin.runCatching { transporte.transceive(byteArrayOf(0x60)) }
            .exceptionOrNull()
        assertTrue(error is NfcOperationException)
        assertEquals(CodigoErrorNfc.NOT_IMPLEMENTED, (error as NfcOperationException).info.code)
    }

    @Test
    fun `el transporte simulado rechaza leer fuera de rango`() = runTest {
        val transporte = TransporteSimulado(TagSimulado.crear(tipoChip = TipoChip.NTAG213))
        val error = kotlin.runCatching { transporte.readUserMemory(0, 200) }.exceptionOrNull()
        assertTrue(error is NfcOperationException)
        assertEquals(CodigoErrorNfc.TRANSPORT_ERROR, (error as NfcOperationException).info.code)
    }

    @Test
    fun `el proveedor NTAG 21x real funciona sobre el transporte simulado`() = runTest {
        // Esto es lo que justifica la abstracción TagTransport: se ejercita el
        // proveedor de producción completo, sin un solo chip ni un emulador.
        val tag = TagSimulado.crear(tipoChip = TipoChip.NTAG215)
        val transporte = TransporteSimulado(tag)
        val deteccion = TagDetection(
            uid = tag.uid,
            chipType = TipoChip.NTAG215,
            technologies = listOf("NfcA"),
        )
        val proveedor = Ntag21xNdefProvider(transporte, deteccion)
        val plan = plan()

        assertFalse(proveedor.capabilities.isSimulation)
        assertFalse(proveedor.capabilities.canProduceCryptographicProof)

        val inspeccion = proveedor.inspectTag(deteccion)
        assertEquals(504, inspeccion.userMemoryBytes)

        val escritura = proveedor.writeNdef(inspeccion, plan)
        assertTrue(escritura.success)

        val verificacion = proveedor.verifyPersonalization(inspeccion, plan, escritura)
        assertTrue(verificacion.matches)
        assertEquals(plan.uri, verificacion.readBackUri)

        // El bloqueo irreversible NO está implementado y se reporta como tal, en
        // lugar de devolver éxito sin haber bloqueado nada.
        val bloqueo = proveedor.lockAllowedAreas(inspeccion, PlanBloqueo(true, false))
        assertFalse(bloqueo.success)
        assertEquals(CodigoErrorNfc.NOT_IMPLEMENTED, bloqueo.error?.code)
    }

    @Test
    fun `el proveedor NTAG 21x rechaza un plan que traiga referencias de clave`() = runTest {
        val tag = TagSimulado.crear()
        val transporte = TransporteSimulado(tag)
        val deteccion = TagDetection(tag.uid, TipoChip.NTAG213, listOf("NfcA"))
        val proveedor = Ntag21xNdefProvider(transporte, deteccion)

        val planConClaves = PersonalizationPlan(
            jobId = "trabajo-2",
            uri = "https://marathon.ec/v/AB",
            // Referencia OPACA, no una clave. Aun así, una NTAG 21x no admite
            // personalización criptográfica y debe rechazarla en lugar de
            // ignorarla en silencio y dar la operación por buena.
            keyReferences = listOf(
                ec.marathon.nfcstudio.domain.model.ReferenciaClave(
                    referencia = "arn:aws:kms:ejemplo",
                    custodio = "kms",
                    version = 1,
                ),
            ),
            lockPlan = PlanBloqueo(false, false),
        )

        val inspeccion = proveedor.inspectTag(deteccion)
        val preparacion = proveedor.preparePersonalization(inspeccion, planConClaves)
        assertFalse(preparacion.ok)
        assertEquals(CodigoErrorNfc.OPERATION_NOT_PERMITTED, preparacion.error?.code)
    }

    @Test
    fun `el proveedor NTAG 21x no hace personalizacion criptografica`() = runTest {
        val tag = TagSimulado.crear()
        val transporte = TransporteSimulado(tag)
        val deteccion = TagDetection(tag.uid, TipoChip.NTAG213, listOf("NfcA"))
        val proveedor = Ntag21xNdefProvider(transporte, deteccion)
        val inspeccion = proveedor.inspectTag(deteccion)

        val resultado = proveedor.personalizeSecureTag(inspeccion, plan())
        assertFalse(resultado.success)
        assertEquals(CodigoErrorNfc.OPERATION_NOT_PERMITTED, resultado.error?.code)
    }
}
