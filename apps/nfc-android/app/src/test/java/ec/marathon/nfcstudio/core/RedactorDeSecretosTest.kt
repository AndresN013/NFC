package ec.marathon.nfcstudio.core

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pruebas del redactor de secretos.
 *
 * Cada prueba corresponde a una fuga real y concreta que ocurriría sin el
 * redactor. No son pruebas de expresiones regulares por sí mismas: son la
 * comprobación de que determinado dato NO PUEDE aparecer en logcat.
 *
 * Criterio general: es aceptable redactar de más. Un log con un "[REDACTADO]"
 * sobrante solo molesta; un log con un token filtrado es un incidente.
 */
class RedactorDeSecretosTest {

    private fun assertNoContiene(textoRedactado: String, secreto: String) {
        assertFalse(
            textoRedactado.contains(secreto),
            "el secreto sigue visible en: $textoRedactado",
        )
    }

    // --- Credenciales de sesión ---------------------------------------------

    @Test
    fun `redacta la cabecera Authorization con Bearer`() {
        val token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.firma-larga-de-ejemplo"
        val salida = RedactorDeSecretos.redactar("Authorization: Bearer $token")

        assertNoContiene(salida, token)
        assertTrue(salida.contains(RedactorDeSecretos.MARCA))
        // Se conserva el contexto para que el log siga siendo útil.
        assertTrue(salida.contains("Authorization"))
    }

    @Test
    fun `redacta tambien Basic y sin importar las mayusculas`() {
        assertNoContiene(
            RedactorDeSecretos.redactar("authorization: basic dXN1YXJpbzpjbGF2ZQ=="),
            "dXN1YXJpbzpjbGF2ZQ==",
        )
        assertNoContiene(
            RedactorDeSecretos.redactar("BEARER AbCdEfGhIjKlMnOp"),
            "AbCdEfGhIjKlMnOp",
        )
    }

    @Test
    fun `redacta la contrasena de un cuerpo json de login`() {
        val cuerpo = """{"email":"operario@marathon.ec","password":"NoMeRobes2024","deviceId":"abc"}"""
        val salida = RedactorDeSecretos.redactar(cuerpo)

        assertNoContiene(salida, "NoMeRobes2024")
        // El nombre del campo se conserva: hace falta para depurar.
        assertTrue(salida.contains("\"password\""))
        // Y el correo también se va, porque es dato personal.
        assertNoContiene(salida, "operario@marathon.ec")
    }

    @Test
    fun `redacta los nombres de campo sensibles mas habituales`() {
        val casos = listOf(
            """{"token":"valor-secreto-1"}""" to "valor-secreto-1",
            """{"accessToken":"valor-secreto-2"}""" to "valor-secreto-2",
            """{"refreshToken":"valor-secreto-3"}""" to "valor-secreto-3",
            """{"secret":"valor-secreto-4"}""" to "valor-secreto-4",
            """{"apiKey":"valor-secreto-5"}""" to "valor-secreto-5",
            """{"clave":"valor-secreto-6"}""" to "valor-secreto-6",
            """{"cmac":"valor-secreto-7"}""" to "valor-secreto-7",
            """{"tagToken":"valor-secreto-8"}""" to "valor-secreto-8",
        )
        for ((entrada, secreto) in casos) {
            assertNoContiene(RedactorDeSecretos.redactar(entrada), secreto)
        }
    }

    @Test
    fun `redacta el formato clave igual valor de las cadenas de consulta`() {
        val salida = RedactorDeSecretos.redactar(
            "GET /api/v1/algo?token=abc123secreto&otro=visible",
        )
        assertNoContiene(salida, "abc123secreto")
        // Lo que no es sensible se conserva, si no el log no sirve de nada.
        assertTrue(salida.contains("otro=visible"))
    }

    // --- Datos del chip -----------------------------------------------------

    @Test
    fun `redacta el uid de un chip`() {
        // El contrato de nfc-contracts marca el UID como dato sensible que nunca
        // debe exponerse.
        val salida = RedactorDeSecretos.redactar("Etiqueta detectada uid=04A1B2C3D4E580 tipo=NTAG213")
        assertNoContiene(salida, "04A1B2C3D4E580")
        // El resto de la línea sobrevive: saber el tipo de chip sí es útil.
        assertTrue(salida.contains("tipo=NTAG213"))
    }

    @Test
    fun `redacta volcados hexadecimales largos de memoria`() {
        // Un volcado de memoria del chip contiene el mensaje NDEF completo, es
        // decir, el token grabado.
        val volcado = "03211D5504657363756465762D766976CAFEBABE0011223344556677889900AABB"
        val salida = RedactorDeSecretos.redactar("payload=$volcado")
        assertNoContiene(salida, volcado)
    }

    @Test
    fun `redacta un token en base64url como el que se graba en el chip`() {
        // generateTagToken() produce 32 bytes en base64url: 43 caracteres.
        val tagToken = "dGVzdC10b2tlbi1kZS1lamVtcGxvLWNvbi00My1jYXJhY3Q"
        val salida = RedactorDeSecretos.redactar("Se grabó el token $tagToken en el chip")
        assertNoContiene(salida, tagToken)
        assertTrue(salida.contains("Se grabó el token"))
    }

    @Test
    fun `redacta el ultimo segmento de una url de verificacion`() {
        // El último segmento de la URL ES el token del chip. Publicarlo en un log
        // equivale a publicar el contenido que un falsificador copiaría.
        val salida = RedactorDeSecretos.redactar(
            "Escribiendo https://escudo-vivo.marathon.ec/v/7bQx9LmNpR en el emblema",
        )
        assertNoContiene(salida, "7bQx9LmNpR")
        // El dominio se conserva: sirve para saber a qué entorno apuntaba.
        assertTrue(salida.contains("escudo-vivo.marathon.ec"))
    }

    // --- Material criptográfico ---------------------------------------------

    @Test
    fun `redacta bloques PEM completos`() {
        // No deberían existir nunca en esta aplicación. El redactor es la segunda
        // barrera por si alguien introdujera uno por error.
        val pem = """
            -----BEGIN PRIVATE KEY-----
            MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA
            -----END PRIVATE KEY-----
        """.trimIndent()
        val salida = RedactorDeSecretos.redactar("Se encontró: $pem")
        assertNoContiene(salida, "MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA")
        assertTrue(salida.contains(RedactorDeSecretos.MARCA))
    }

    // --- Lo que NO debe tocarse ---------------------------------------------

    @Test
    fun `no toca los mensajes de operario ni los identificadores de orden`() {
        val mensajes = listOf(
            "Se perdió el contacto. Mantenga el emblema apoyado sin moverlo hasta que suene.",
            "Orden ORD-2024-0417 · club Barcelona SC · lote LOTE-88",
            "Reserva de trabajo: HTTP 409 código=CONFLICT",
            "Modo lector activado.",
            "Relectura distinta de lo grabado para el trabajo 7f3a-1",
            "Unidad MEV-4K7PQR2M apartada por daño físico",
        )
        for (mensaje in mensajes) {
            assertEquals(
                mensaje,
                RedactorDeSecretos.redactar(mensaje),
                "el redactor alteró un mensaje que no contenía secretos",
            )
        }
    }

    @Test
    fun `es idempotente`() {
        // Aplicarlo dos veces no debe producir marcas anidadas ni perder texto.
        val entrada = """{"password":"secreta"} y Bearer abcdefghijkl"""
        val unaVez = RedactorDeSecretos.redactar(entrada)
        assertEquals(unaVez, RedactorDeSecretos.redactar(unaVez))
    }

    @Test
    fun `tolera la cadena vacia y el texto sin secretos`() {
        assertEquals("", RedactorDeSecretos.redactar(""))
        assertEquals("sin nada que ocultar", RedactorDeSecretos.redactar("sin nada que ocultar"))
    }

    // --- Huella corta -------------------------------------------------------

    @Test
    fun `la huella corta no revela el valor completo`() {
        val uid = "04A1B2C3D4E580"
        val huella = RedactorDeSecretos.huellaCorta(uid)

        assertNoContiene(huella, uid)
        // Conserva lo justo para poder correlacionar dos líneas del mismo emblema.
        assertTrue(huella.startsWith("04A1"))
        assertTrue(huella.contains("14"), "debe indicar la longitud original")
        assertTrue(huella.length < uid.length + 4)
    }

    @Test
    fun `la huella corta de un valor ausente es explicita`() {
        assertEquals("vacio", RedactorDeSecretos.huellaCorta(null))
        assertEquals("vacio", RedactorDeSecretos.huellaCorta(""))
        assertEquals("vacio", RedactorDeSecretos.huellaCorta("   "))
    }
}
