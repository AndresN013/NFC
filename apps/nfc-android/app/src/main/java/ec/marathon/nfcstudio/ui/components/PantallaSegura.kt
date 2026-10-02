package ec.marathon.nfcstudio.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import ec.marathon.nfcstudio.core.Registro

/**
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "FLAG_SECURE en las vistas sensibles".          #
 * ###########################################################################
 *
 * Activa `WindowManager.LayoutParams.FLAG_SECURE` mientras la pantalla que lo
 * invoca esta visible, y lo retira al salir.
 *
 * Que consigue: el sistema impide las capturas de pantalla, bloquea la grabacion
 * de la pantalla y excluye la ventana de la vista de aplicaciones recientes
 * (donde Android guarda una miniatura EN DISCO).
 *
 * Por que importa aqui, concretamente: la pantalla de programación muestra la
 * URI que se graba en el chip, que contiene el token de la unidad. Una captura
 * de esa pantalla enviada por mensajeria es el contenido del chip publicado. La
 * miniatura de recientes es peor todavia, porque la escribe el sistema sin que
 * nadie la pida.
 *
 * Donde se usa: Programación, Verificación y Configuración. NO se usa en la
 * lista de órdenes ni en el historial, porque ahi no hay nada sensible y bloquear
 * capturas innecesariamente estorba al supervisor que quiere enviar una foto de
 * la cola de trabajo.
 *
 * Nota: la pantalla de Login tambien lo activa. El teclado no aparece en las
 * capturas, pero el correo del operario si, y es dato personal.
 */
@Composable
fun EfectoPantallaSegura(activa: Boolean = true) {
    val vista = LocalView.current

    DisposableEffect(vista, activa) {
        val ventana = vista.context.buscarActividad()?.window
        if (ventana == null) {
            // Si no hay ventana no se puede proteger. Se registra porque es un
            // fallo silencioso peligroso: la pantalla se veria igual pero sin
            // proteccion, y nadie se enteraria.
            Registro.advertencia(
                "PantallaSegura",
                "No se pudo aplicar FLAG_SECURE: no hay ventana asociada a la vista.",
            )
            return@DisposableEffect onDispose { }
        }

        if (activa) {
            ventana.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }

        onDispose {
            if (activa) {
                ventana.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
    }
}

/** Recorre la cadena de contextos hasta encontrar la Activity. */
private fun Context.buscarActividad(): Activity? {
    var actual: Context? = this
    while (actual is ContextWrapper) {
        if (actual is Activity) return actual
        actual = actual.baseContext
    }
    return null
}
