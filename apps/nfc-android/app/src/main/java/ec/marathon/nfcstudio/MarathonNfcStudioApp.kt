package ec.marathon.nfcstudio

import android.app.Application
import ec.marathon.nfcstudio.core.Registro

/**
 * Punto de entrada del proceso.
 *
 * Lo unico que hace es construir el [ContenedorApp]. No se hace trabajo pesado
 * aqui: en un telefono de planta de gama media, cada milisegundo de `onCreate`
 * de la Application es un milisegundo de pantalla en blanco cada vez que el
 * sistema mata el proceso por memoria, que en una nave con la app abierta todo
 * el turno ocurre varias veces al dia.
 */
class MarathonNfcStudioApp : Application() {

    lateinit var contenedor: ContenedorApp
        private set

    override fun onCreate() {
        super.onCreate()
        contenedor = ContenedorApp(this)
        Registro.informacion(
            "Aplicacion",
            "Marathon NFC Studio ${BuildConfig.VERSION_NAME} iniciado.",
        )
    }
}
