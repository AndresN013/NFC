package ec.marathon.nfcstudio.core

import android.util.Log
import ec.marathon.nfcstudio.BuildConfig

/**
 * Registro de la aplicacion con REDACCION OBLIGATORIA de secretos.
 *
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Sin secretos en logs".                         #
 * ###########################################################################
 *
 * Nadie escribe en `android.util.Log` directamente en este proyecto. Todo pasa
 * por [Registro], que aplica [RedactorDeSecretos] antes de emitir una sola
 * linea. El motivo es concreto: logcat es legible por cualquier aplicacion con
 * permiso de depuracion en un telefono con USB activado, y un telefono de
 * planta pasa por muchas manos.
 *
 * Lo que se redacta y por que:
 *  - Token de sesion / cabeceras Authorization -> permite suplantar al operario.
 *  - Contrasenas en cuerpos JSON -> obvio.
 *  - UID de chip -> es un identificador de la unidad fisica; el contrato de
 *    `packages/nfc-contracts` lo marca como "dato sensible: nunca se expone".
 *  - tagToken (base64url de 43 caracteres) -> es LO QUE SE GRABA EN EL CHIP.
 *    Filtrarlo equivale a publicar el contenido que un falsificador copiaria.
 *  - Material de clave: no deberia existir en la app (ver KeyReference), pero
 *    el patron se filtra igualmente como defensa en profundidad.
 *
 * Ademas, en compilaciones de release las llamadas a Log.v/d/i se eliminan por
 * ProGuard (ver app/proguard-rules.pro).
 */
object Registro {

    /** En release solo se emiten advertencias y errores, ya redactados. */
    private val nivelMinimo: Int = if (BuildConfig.DEBUG) Log.VERBOSE else Log.WARN

    fun detalle(etiqueta: String, mensaje: String) = emitir(Log.VERBOSE, etiqueta, mensaje, null)

    fun depuracion(etiqueta: String, mensaje: String) = emitir(Log.DEBUG, etiqueta, mensaje, null)

    fun informacion(etiqueta: String, mensaje: String) = emitir(Log.INFO, etiqueta, mensaje, null)

    fun advertencia(etiqueta: String, mensaje: String, causa: Throwable? = null) =
        emitir(Log.WARN, etiqueta, mensaje, causa)

    fun error(etiqueta: String, mensaje: String, causa: Throwable? = null) =
        emitir(Log.ERROR, etiqueta, mensaje, causa)

    private fun emitir(nivel: Int, etiqueta: String, mensaje: String, causa: Throwable?) {
        if (nivel < nivelMinimo) return
        val limpio = RedactorDeSecretos.redactar(mensaje)
        // La causa tambien se redacta: los mensajes de excepcion de OkHttp
        // pueden incluir la URL completa, y una URL de verificacion lleva el
        // token del chip.
        val limpioConCausa = if (causa == null) {
            limpio
        } else {
            "$limpio | causa=${RedactorDeSecretos.redactar(causa.javaClass.simpleName + ": " + (causa.message ?: "sin mensaje"))}"
        }
        Log.println(nivel, etiqueta, limpioConCausa)
    }
}

/**
 * Redactor de patrones sensibles. Logica pura y sin dependencias de Android
 * para que pueda probarse en la JVM (ver `RedactorDeSecretosTest`).
 *
 * Criterio de diseno: es preferible redactar de mas que de menos. Un log con
 * un "[REDACTADO]" sobrante solo molesta; un log con un token filtrado es un
 * incidente de seguridad.
 */
object RedactorDeSecretos {

    const val MARCA = "[REDACTADO]"

    /**
     * Cada regla lleva el motivo por el que existe. El orden importa: las
     * reglas con contexto (clave: valor) van antes que las genericas, para que
     * la sustitucion conserve el nombre del campo y el log siga siendo util.
     */
    private data class Regla(val motivo: String, val patron: Regex, val reemplazo: String)

    private val reglas: List<Regla> = listOf(
        Regla(
            motivo = "Cabecera Authorization completa (Bearer / Basic)",
            patron = Regex("""(?i)\b(bearer|basic)\s+[A-Za-z0-9\-._~+/=]{8,}"""),
            reemplazo = "\$1 $MARCA",
        ),
        Regla(
            motivo = "Campos JSON con nombre sensible: password, token, secret, key, pin, cmac...",
            patron = Regex(
                // El patrón termina con la clase `["]` en lugar de una comilla
                // suelta para no cerrar la cadena sin formato con cuatro comillas
                // seguidas, que es difícil de leer y fácil de romper al editar.
                """(?i)"(password|contrasena|contrasenia|pass|token|accessToken|refreshToken|secret|apiKey|api_key|key|clave|pin|cmac|mac|signature|firma|tagToken|sessionToken)"\s*:\s*"[^"]*["]"""
            ),
            reemplazo = "\"\$1\":\"$MARCA\"",
        ),
        Regla(
            motivo = "Los mismos nombres en formato clave=valor (logs de OkHttp, query strings)",
            patron = Regex(
                """(?i)\b(password|contrasena|token|secret|apikey|api_key|key|clave|pin|cmac|signature|firma)\s*[=:]\s*[^\s,;&)\]}"']+"""
            ),
            reemplazo = "\$1=$MARCA",
        ),
        Regla(
            motivo = "UID de chip en hexadecimal (7 bytes NTAG = 14 hex, 4 bytes = 8 hex)",
            patron = Regex("""(?i)\b(uid|nuid)\s*[=:]\s*[0-9a-f]{8,20}\b"""),
            reemplazo = "\$1=$MARCA",
        ),
        Regla(
            motivo = "Volcados hexadecimales largos: pueden ser memoria del chip o material de clave",
            patron = Regex("""(?i)\b[0-9a-f]{32,}\b"""),
            reemplazo = MARCA,
        ),
        Regla(
            motivo = "tagToken: 32 bytes en base64url = 43 caracteres sin relleno",
            patron = Regex("""\b[A-Za-z0-9_-]{40,}\b"""),
            reemplazo = MARCA,
        ),
        Regla(
            motivo = "Correo del operario: dato personal, no hace falta para depurar",
            patron = Regex("""\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"""),
            reemplazo = MARCA,
        ),
        Regla(
            motivo = "URL de verificacion: el ultimo segmento ES el token del chip",
            patron = Regex("""(?i)(https?://[^\s"']*/(?:v|verificar|t)/)[A-Za-z0-9_\-]+"""),
            reemplazo = "\$1$MARCA",
        ),
        Regla(
            motivo = "Bloques PEM: no deberian existir jamas en esta app",
            patron = Regex("""-----BEGIN[\s\S]*?-----END[^-]*-----"""),
            reemplazo = MARCA,
        ),
    )

    fun redactar(texto: String): String {
        var salida = texto
        for (regla in reglas) {
            salida = regla.patron.replace(salida, regla.reemplazo)
        }
        return salida
    }

    /**
     * Version corta y segura de un UID para poder correlacionar dos lineas de
     * log sin revelar el identificador: primeros 4 caracteres y longitud.
     * Se usa en el registro de auditoria local del historial del operario.
     */
    fun huellaCorta(valor: String?): String {
        if (valor.isNullOrBlank()) return "vacio"
        val prefijo = valor.take(4)
        return "$prefijo…(${valor.length})"
    }
}
