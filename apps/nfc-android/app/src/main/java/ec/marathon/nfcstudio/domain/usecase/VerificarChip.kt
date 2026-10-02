package ec.marathon.nfcstudio.domain.usecase

import ec.marathon.nfcstudio.domain.model.MetodoVerificacion
import ec.marathon.nfcstudio.domain.model.NivelConfianza
import ec.marathon.nfcstudio.domain.model.aplicarTechoDelMetodo
import ec.marathon.nfcstudio.domain.model.soportaAutenticacionCriptografica
import ec.marathon.nfcstudio.nfc.NfcPersonalizationProvider
import ec.marathon.nfcstudio.nfc.TagDetection
import ec.marathon.nfcstudio.nfc.VerificationPayload

/**
 * Lectura de comprobacion: lee el chip igual que lo haria el telefono de un
 * aficionado y muestra el nivel de confianza REAL que produce.
 *
 * Existe para una razon concreta y poco tecnica: que nadie en planta crea que
 * grabar una NTAG 213 produce un jersey "autenticado". La pantalla ensena el
 * techo de confianza alcanzable con el chip y el proveedor que se estan usando,
 * con su explicacion en lenguaje llano.
 *
 * IMPORTANTE: el nivel que calcula esta clase es INFORMATIVO y local. El nivel
 * que vale es el que emite el servidor con su motor de riesgo; el telefono no
 * tiene ni el historial de lecturas ni las senales de abuso, y un cliente que se
 * autocalifica no prueba nada.
 */
class VerificarChip {

    data class Lectura(
        val payload: VerificationPayload,
        val nivelLocal: NivelConfianza,
        val metodo: MetodoVerificacion,
        val simulado: Boolean,
        /** Explicacion honesta de por que el nivel es el que es. */
        val motivo: String,
    )

    suspend fun ejecutar(
        proveedor: NfcPersonalizationProvider,
        deteccion: TagDetection,
    ): Lectura {
        val payload = proveedor.readVerificationPayload(deteccion)

        val metodo = when {
            payload.authenticatedMessage != null -> MetodoVerificacion.NFC_CRYPTOGRAPHIC
            else -> MetodoVerificacion.NFC_STATIC_URL
        }

        // Punto de partida: si se leyo algo, el producto queda IDENTIFICADO.
        val base = when {
            payload.token.isNullOrBlank() -> NivelConfianza.UNVERIFIABLE
            payload.authenticatedMessage != null &&
                proveedor.capabilities.canProduceCryptographicProof -> NivelConfianza.VERIFIED
            else -> NivelConfianza.IDENTIFIED_ONLY
        }

        // El techo del metodo solo puede degradar, nunca elevar.
        var nivel = aplicarTechoDelMetodo(base, metodo)

        // Regla dura: una lectura simulada NUNCA alcanza VERIFIED.
        if (payload.simulated && nivel == NivelConfianza.VERIFIED) {
            nivel = NivelConfianza.IDENTIFIED_ONLY
        }

        val motivo = when {
            payload.simulated ->
                "Lectura producida por el simulador. No constituye evidencia de nada."
            payload.token.isNullOrBlank() ->
                "No se pudo leer el contenido del emblema."
            !soportaAutenticacionCriptografica(deteccion.chipType) ->
                "Este tipo de chip no puede realizar una comprobación de seguridad. " +
                    "Como máximo identifica el producto, y su contenido es copiable."
            !proveedor.capabilities.canProduceCryptographicProof ->
                "El chip sería capaz, pero el equipo todavía no tiene implementada la " +
                    "comprobación de seguridad. Por eso el resultado solo identifica."
            else ->
                "El chip respondió a una comprobación de seguridad."
        }

        return Lectura(
            payload = payload,
            nivelLocal = nivel,
            metodo = metodo,
            simulado = payload.simulated,
            motivo = motivo,
        )
    }
}
