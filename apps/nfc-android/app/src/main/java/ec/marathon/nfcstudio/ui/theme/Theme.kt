package ec.marathon.nfcstudio.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

/**
 * Tema de la aplicacion.
 *
 * SIEMPRE oscuro, tanto si el sistema esta en claro como en oscuro. No es una
 * preferencia estetica: el puesto de trabajo tiene el telefono en horizontal
 * sobre la mesa durante ocho horas, y un fondo blanco a maximo brillo bajo
 * fluorescentes produce fatiga visual y reflejos sobre el propio emblema.
 *
 * Tampoco se usa color dinamico (Material You): la paleta de significado
 * (aprobado / rechazado / simulación) debe ser IDENTICA en los cuarenta
 * teléfonos de la nave. Un verde que en un modelo sale azulado es un riesgo
 * operativo, no un detalle de diseño.
 */
private val EsquemaPlanta = darkColorScheme(
    primary = AzulMarathonClaro,
    onPrimary = TextoPrincipal,
    primaryContainer = AzulMarathon,
    onPrimaryContainer = TextoPrincipal,
    secondary = AmbarAviso,
    onSecondary = AzulMarathonProfundo,
    tertiary = NaranjaSimulacion,
    onTertiary = TextoPrincipal,
    background = GrisFondo,
    onBackground = TextoPrincipal,
    surface = GrisSuperficie,
    onSurface = TextoPrincipal,
    surfaceVariant = GrisSuperficieAlta,
    onSurfaceVariant = TextoSecundario,
    outline = GrisBorde,
    error = RojoRechazo,
    onError = TextoPrincipal,
    errorContainer = RojoRechazoSuave,
    onErrorContainer = TextoPrincipal,
)

@Composable
fun TemaMarathonNfcStudio(
    // Se acepta el parametro por si una vista previa quiere forzarlo, pero el
    // valor no altera el esquema: ver el comentario de arriba.
    @Suppress("UNUSED_PARAMETER") oscuro: Boolean = isSystemInDarkTheme(),
    contenido: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = EsquemaPlanta,
        typography = TipografiaPlanta,
        content = contenido,
    )
}
