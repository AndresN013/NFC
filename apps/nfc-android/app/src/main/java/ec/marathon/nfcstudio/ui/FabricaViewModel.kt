package ec.marathon.nfcstudio.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

/**
 * Fabrica generica de ViewModels.
 *
 * Con inyeccion manual (ver ContenedorApp) los ViewModels reciben sus
 * dependencias por constructor, y Compose necesita una fabrica para crearlos.
 * Esta funcion evita escribir una clase de fabrica por cada pantalla.
 */
@Suppress("UNCHECKED_CAST")
fun <VM : ViewModel> fabricaDe(constructor: () -> VM): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(claseModelo: Class<T>): T = constructor() as T
    }
