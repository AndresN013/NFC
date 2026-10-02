package ec.marathon.nfcstudio

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import ec.marathon.nfcstudio.ui.NavegacionApp
import ec.marathon.nfcstudio.ui.theme.TemaMarathonNfcStudio

/**
 * Unica Activity de la aplicacion.
 *
 * Es unica a proposito: el modo lector de NFC (`enableReaderMode`) se asocia a
 * UNA Activity, y con varias habria que registrarlo y desregistrarlo en cada
 * transicion, con una ventana en la que un emblema apoyado no se detectaria.
 *
 * `launchMode="singleTask"` y orientacion fija en portrait (ver el manifiesto):
 * el telefono vive en un soporte en la mesa y una rotacion accidental a mitad de
 * escritura recrearia la Activity, lo que desactivaria el modo lector durante el
 * instante mas delicado del proceso.
 */
class MainActivity : ComponentActivity() {

    private val contenedor: ContenedorApp
        get() = (application as MarathonNfcStudioApp).contenedor

    override fun onCreate(estadoGuardado: Bundle?) {
        super.onCreate(estadoGuardado)
        setContent {
            TemaMarathonNfcStudio {
                NavegacionApp(contenedor = contenedor)
            }
        }
    }

    /**
     * El modo lector se activa SOLO mientras la Activity esta en primer plano.
     *
     * Si se dejara activo en segundo plano, el telefono capturaria cualquier
     * etiqueta cercana (incluida la tarjeta de acceso del operario) y consumiria
     * bateria toda la jornada.
     */
    override fun onResume() {
        super.onResume()
        contenedor.lectorNfc.activarModoLector(this)
        // El operario puede haber activado el NFC en los ajustes y vuelto aqui.
        contenedor.lectorNfc.refrescarEstado()
    }

    override fun onPause() {
        super.onPause()
        contenedor.lectorNfc.desactivarModoLector(this)
    }
}
