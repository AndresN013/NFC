package ec.marathon.nfcstudio.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ec.marathon.nfcstudio.ui.theme.AmbarAviso
import ec.marathon.nfcstudio.ui.theme.AmbarAvisoSuave
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.RojoRechazoSuave
import ec.marathon.nfcstudio.ui.theme.TextoPrincipal
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado
import ec.marathon.nfcstudio.ui.theme.VerdeAprobadoSuave

/**
 * Andamio comun de todas las pantallas.
 *
 * Centraliza el banner de SIMULACION para que sea IMPOSIBLE crear una pantalla
 * que se olvide de mostrarlo: si se usa este andamio, el banner esta. Es la
 * razon de que exista.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AndamioPlanta(
    titulo: String,
    modoSimulacion: Boolean,
    alVolver: (() -> Unit)? = null,
    acciones: @Composable () -> Unit = {},
    piePantalla: @Composable () -> Unit = {},
    contenido: @Composable (Modifier) -> Unit,
) {
    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text(titulo, maxLines = 2) },
                    navigationIcon = {
                        if (alVolver != null) {
                            IconButton(onClick = alVolver) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "Volver",
                                )
                            }
                        }
                    },
                    actions = { acciones() },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        titleContentColor = TextoPrincipal,
                        navigationIconContentColor = TextoPrincipal,
                        actionIconContentColor = TextoPrincipal,
                    ),
                )
                // Banner permanente, inmediatamente bajo la barra de titulo y por
                // encima de cualquier contenido.
                if (modoSimulacion) BannerSimulacion()
            }
        },
        bottomBar = { piePantalla() },
    ) { relleno ->
        contenido(Modifier.padding(relleno))
    }
}

/** Tono de un mensaje al operario. El color NUNCA es la unica senal: hay icono. */
enum class TonoMensaje { EXITO, AVISO, ERROR, INFORMACION }

/**
 * Tarjeta de mensaje al operario.
 *
 * Los textos que se le pasan estan redactados para alguien en planta: dicen QUE
 * HACER, no qué falló. "Mantenga el emblema apoyado sin moverlo" en lugar de
 * "TAG_LOST: transceive failed".
 */
@Composable
fun MensajeOperario(
    texto: String,
    tono: TonoMensaje,
    modificador: Modifier = Modifier,
    titulo: String? = null,
) {
    val (colorFondo, colorAcento, icono) = when (tono) {
        TonoMensaje.EXITO -> Triple(VerdeAprobadoSuave, VerdeAprobado, Icons.Filled.CheckCircle)
        TonoMensaje.AVISO -> Triple(AmbarAvisoSuave, AmbarAviso, Icons.Filled.WarningAmber)
        TonoMensaje.ERROR -> Triple(RojoRechazoSuave, RojoRechazo, Icons.Filled.ErrorOutline)
        TonoMensaje.INFORMACION -> Triple(
            MaterialTheme.colorScheme.surfaceVariant,
            MaterialTheme.colorScheme.primary,
            Icons.Filled.Info,
        )
    }

    Card(
        modifier = modificador.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = colorFondo),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(modifier = Modifier.padding(16.dp)) {
            Icon(
                imageVector = icono,
                contentDescription = null,
                tint = colorAcento,
                modifier = Modifier.size(32.dp),
            )
            Column(modifier = Modifier.padding(start = 12.dp)) {
                if (titulo != null) {
                    Text(
                        text = titulo,
                        style = MaterialTheme.typography.titleMedium,
                        color = TextoPrincipal,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Text(
                    text = texto,
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextoPrincipal,
                )
            }
        }
    }
}

/**
 * Boton principal grande.
 *
 * Altura minima de 64 dp: el operario lo pulsa con guante de trabajo, y el area
 * tactil recomendada de 48 dp esta pensada para un dedo desnudo.
 */
@Composable
fun BotonPrincipal(
    texto: String,
    alPulsar: () -> Unit,
    modificador: Modifier = Modifier,
    habilitado: Boolean = true,
    cargando: Boolean = false,
    color: Color? = null,
) {
    Button(
        onClick = alPulsar,
        enabled = habilitado && !cargando,
        modifier = modificador
            .fillMaxWidth()
            .heightIn(min = 64.dp),
        colors = if (color != null) {
            ButtonDefaults.buttonColors(containerColor = color, contentColor = TextoPrincipal)
        } else {
            ButtonDefaults.buttonColors()
        },
    ) {
        if (cargando) {
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                color = TextoPrincipal,
                strokeWidth = 3.dp,
            )
        } else {
            Text(texto, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun BotonSecundario(
    texto: String,
    alPulsar: () -> Unit,
    modificador: Modifier = Modifier,
    habilitado: Boolean = true,
) {
    OutlinedButton(
        onClick = alPulsar,
        enabled = habilitado,
        modifier = modificador
            .fillMaxWidth()
            .heightIn(min = 56.dp),
    ) {
        Text(texto, style = MaterialTheme.typography.labelLarge)
    }
}

/** Fila etiqueta / valor para las fichas de datos (orden, chip, unidad). */
@Composable
fun FilaDato(
    etiqueta: String,
    valor: String,
    modificador: Modifier = Modifier,
    destacado: Boolean = false,
) {
    Row(
        modifier = modificador
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = etiqueta,
            style = MaterialTheme.typography.bodyMedium,
            color = TextoSecundario,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = valor,
            style = if (destacado) {
                MaterialTheme.typography.titleMedium
            } else {
                MaterialTheme.typography.bodyLarge
            },
            color = TextoPrincipal,
            fontWeight = if (destacado) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.weight(1.4f),
        )
    }
}

/** Tarjeta contenedora estandar. */
@Composable
fun TarjetaSeccion(
    titulo: String? = null,
    modificador: Modifier = Modifier,
    contenido: @Composable () -> Unit,
) {
    Card(
        modifier = modificador.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            if (titulo != null) {
                Text(
                    text = titulo,
                    style = MaterialTheme.typography.titleMedium,
                    color = TextoPrincipal,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            contenido()
        }
    }
}

@Composable
fun CargandoPantalla(mensaje: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(modifier = Modifier.size(56.dp), strokeWidth = 5.dp)
            Text(
                text = mensaje,
                style = MaterialTheme.typography.titleMedium,
                color = TextoSecundario,
                modifier = Modifier.padding(top = 20.dp),
            )
        }
    }
}

/** Icono grande para los estados de resultado. */
@Composable
fun IconoResultado(icono: ImageVector, tinte: Color, modificador: Modifier = Modifier) {
    Icon(
        imageVector = icono,
        contentDescription = null,
        tint = tinte,
        modifier = modificador.size(96.dp),
    )
}
