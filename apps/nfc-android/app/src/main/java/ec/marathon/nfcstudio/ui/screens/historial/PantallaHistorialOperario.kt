package ec.marathon.nfcstudio.ui.screens.historial

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.domain.model.EventoHistorial
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.NaranjaSimulacion
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Historial del turno del operario.
 *
 * NO lleva FLAG_SECURE a propósito: aquí no hay ningún dato sensible (los
 * identificadores de chip se guardan como huella corta) y al supervisor le
 * resulta útil poder enviar una captura del resumen del turno.
 */
@Composable
fun PantallaHistorialOperario(
    modelo: HistorialViewModel,
    modoSimulacion: Boolean,
    alVolver: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()
    val formato = recordarFormatoHora()

    AndamioPlanta(
        titulo = "Mi turno",
        modoSimulacion = modoSimulacion,
        alVolver = alVolver,
    ) { modificador ->
        when (val actual = estado) {
            is HistorialViewModel.EstadoUi.Cargando ->
                CargandoPantalla("Cargando el historial…")

            is HistorialViewModel.EstadoUi.Vacio -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = "Todavía no hay movimientos registrados en este teléfono.",
                    tono = TonoMensaje.INFORMACION,
                )
            }

            is HistorialViewModel.EstadoUi.ConEventos -> LazyColumn(
                modifier = modificador
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(vertical = 16.dp),
            ) {
                item {
                    TarjetaSeccion(titulo = "Resumen") {
                        FilaDato("Movimientos", actual.total.toString(), destacado = true)
                        FilaDato("Correctos", actual.correctos.toString())
                        FilaDato("Con problema", actual.fallidos.toString())
                        if (actual.simulados > 0) {
                            FilaDato("En simulación (no cuentan)", actual.simulados.toString())
                        }
                    }
                }

                item {
                    MensajeOperario(
                        texto = "Esta lista es una copia guardada en el teléfono para que pueda " +
                            "consultarla sin red. El registro oficial está en el sistema central.",
                        tono = TonoMensaje.INFORMACION,
                    )
                }

                items(actual.eventos, key = { it.idEvento }) { evento ->
                    TarjetaEvento(evento = evento, formato = formato)
                }

                item {
                    Spacer(Modifier.height(8.dp))
                    BotonSecundario(
                        texto = "Borrar el historial de este teléfono",
                        alPulsar = modelo::limpiar,
                    )
                }
            }
        }
    }
}

@Composable
private fun TarjetaEvento(evento: EventoHistorial, formato: SimpleDateFormat) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Row(modifier = Modifier.padding(14.dp)) {
            Icon(
                imageVector = if (evento.exito) Icons.Filled.CheckCircle else Icons.Filled.Cancel,
                contentDescription = if (evento.exito) "Correcto" else "Con problema",
                tint = when {
                    evento.simulado -> NaranjaSimulacion
                    evento.exito -> VerdeAprobado
                    else -> RojoRechazo
                },
                modifier = Modifier.size(28.dp),
            )
            Column(modifier = Modifier.padding(start = 12.dp)) {
                Text(
                    text = evento.paso.titulo,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "${formato.format(Date(evento.marcaTiempoMs))} · " +
                        "orden ${evento.codigoOrden} · emblema ${evento.huellaChip}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextoSecundario,
                )
                if (evento.detalle.isNotBlank()) {
                    Text(
                        text = evento.detalle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                }
                if (evento.simulado) {
                    Text(
                        text = "SIMULACIÓN",
                        style = MaterialTheme.typography.labelMedium,
                        color = NaranjaSimulacion,
                    )
                }
            }
        }
    }
}

/** Formato de hora local. Se recuerda para no recrearlo en cada recomposición. */
@Composable
private fun recordarFormatoHora(): SimpleDateFormat =
    androidx.compose.runtime.remember {
        SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    }
