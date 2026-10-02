package ec.marathon.nfcstudio.data.session

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import ec.marathon.nfcstudio.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.UUID

private val Context.almacenPreferencias: DataStore<Preferences> by preferencesDataStore(
    name = "preferencias_nfc_studio",
)

/**
 * Preferencias NO sensibles de la aplicacion.
 *
 * Aqui va lo que puede leerse sin consecuencias: la URL del servidor, si el modo
 * simulacion esta activo, el identificador aleatorio de esta instalacion. El
 * token de sesion NO esta aqui, esta en [AlmacenSesion], cifrado.
 *
 * Se usa DataStore en lugar de SharedPreferences porque expone flujos: la
 * pantalla de Configuracion cambia el modo simulacion y el banner de SIMULACION
 * aparece en todas las pantallas sin ningun mecanismo de notificacion propio.
 */
class PreferenciasApp(private val contexto: Context) {

    val urlBase: Flow<String> = contexto.almacenPreferencias.data.map { preferencias ->
        preferencias[CLAVE_URL_BASE] ?: BuildConfig.URL_API_POR_DEFECTO
    }

    val modoSimulacion: Flow<Boolean> = contexto.almacenPreferencias.data.map { preferencias ->
        preferencias[CLAVE_MODO_SIMULACION] ?: false
    }

    val ultimoCorreo: Flow<String> = contexto.almacenPreferencias.data.map { preferencias ->
        preferencias[CLAVE_ULTIMO_CORREO] ?: ""
    }

    /**
     * Identificador de ESTA INSTALACION.
     *
     * Es un UUID aleatorio generado la primera vez y guardado aqui.
     * Deliberadamente NO se usa ANDROID_ID ni ningun identificador de hardware:
     * esos persisten entre instalaciones, identifican al dispositivo fisico y en
     * Ecuador, como en la UE, son datos personales cuando se combinan con la
     * identidad del operario. Un UUID por instalacion cumple la funcion (saber
     * qué teléfono grabó qué chip) sin arrastrar ese problema, y se invalida al
     * desinstalar, que es exactamente lo que interesa cuando un equipo se retira.
     */
    val idDispositivo: Flow<String> = contexto.almacenPreferencias.data.map { preferencias ->
        preferencias[CLAVE_ID_DISPOSITIVO] ?: ""
    }

    suspend fun asegurarIdDispositivo(): String {
        var identificador = ""
        contexto.almacenPreferencias.edit { preferencias ->
            val existente = preferencias[CLAVE_ID_DISPOSITIVO]
            identificador = if (existente.isNullOrBlank()) {
                UUID.randomUUID().toString().also { preferencias[CLAVE_ID_DISPOSITIVO] = it }
            } else {
                existente
            }
        }
        return identificador
    }

    suspend fun guardarUrlBase(url: String) {
        contexto.almacenPreferencias.edit { it[CLAVE_URL_BASE] = url.trim() }
    }

    suspend fun guardarModoSimulacion(activo: Boolean) {
        contexto.almacenPreferencias.edit { it[CLAVE_MODO_SIMULACION] = activo }
    }

    suspend fun guardarUltimoCorreo(correo: String) {
        contexto.almacenPreferencias.edit { it[CLAVE_ULTIMO_CORREO] = correo.trim() }
    }

    /** Historial local del turno, serializado como JSON. Ver RepositorioHistorial. */
    val historialJson: Flow<String> = contexto.almacenPreferencias.data.map { preferencias ->
        preferencias[CLAVE_HISTORIAL] ?: "[]"
    }

    suspend fun guardarHistorialJson(json: String) {
        contexto.almacenPreferencias.edit { it[CLAVE_HISTORIAL] = json }
    }

    /**
     * Operaciones que fallaron y esperan reintento, serializadas como JSON.
     *
     * Se persisten a proposito: si la aplicacion muere (el sistema la mata por
     * memoria, o el operario la cierra sin querer con guantes puestos), la clave
     * de idempotencia del intento se conservaria y el reintento seguiria siendo
     * el MISMO intento a ojos del servidor. Perderla convertiria un reintento en
     * una operacion nueva.
     */
    val pendientesJson: Flow<String> = contexto.almacenPreferencias.data.map { preferencias ->
        preferencias[CLAVE_PENDIENTES] ?: "[]"
    }

    suspend fun guardarPendientesJson(json: String) {
        contexto.almacenPreferencias.edit { it[CLAVE_PENDIENTES] = json }
    }

    private companion object {
        val CLAVE_URL_BASE = stringPreferencesKey("url_base")
        val CLAVE_MODO_SIMULACION = booleanPreferencesKey("modo_simulacion")
        val CLAVE_ULTIMO_CORREO = stringPreferencesKey("ultimo_correo")
        val CLAVE_ID_DISPOSITIVO = stringPreferencesKey("id_dispositivo")
        val CLAVE_HISTORIAL = stringPreferencesKey("historial_turno")
        val CLAVE_PENDIENTES = stringPreferencesKey("operaciones_pendientes")
    }
}
