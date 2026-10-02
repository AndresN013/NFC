package ec.marathon.nfcstudio.ui.screens.errores

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.data.repository.OperacionPendiente
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.TextoSecundario

/**
 * Pantalla de errores y reintentos.
 *
 * Muestra, en lenguaje de planta, QUÉ le falta por enviar al sistema. El texto
 * evita la palabra "error" cuando el problema es de red: para el operario, un
 * aviso que no salió porque la nave no tiene cobertura no es un error suyo.
 */
@Composable
fun PantallaErroresYReintentos(
    modelo: ErroresViewModel,
    modoSimulacion: Boolean,
    alVolver: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()

    AndamioPlanta(
        titulo = "Pendientes de enviar",
        modoSimulacion = modoSimulacion,
        alVolver = alVolver,
    ) { modificador ->
        when (val actual = estado) {
            is ErroresViewModel.EstadoUi.Cargando ->
                CargandoPantalla("Revisando lo pendiente…")

            is ErroresViewModel.EstadoUi.SinPendientes -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = "Todo está enviado. No queda nada pendiente en este teléfono.",
                    tono = TonoMensaje.EXITO,
                )
            }

            is ErroresViewModel.EstadoUi.ConPendientes -> LazyColumn(
                modifier = modificador
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(vertical = 16.dp),
            ) {
                item {
                    MensajeOperario(
                        texto = "Estas operaciones ya se hicieron en el emblema o en el jersey, " +
                            "pero el aviso al sistema no salió. Reintentar es seguro: el sistema " +
                            "reconoce que es el mismo intento y no duplica nada.",
                        tono = TonoMensaje.AVISO,
                        titulo = "Qué significa esta lista",
                    )
                }

                if (actual.ultimoExito != null) {
                    item {
                        MensajeOperario(texto = actual.ultimoExito!!, tono = TonoMensaje.EXITO)
                    }
                }

                if (actual.ultimoError != null) {
                    item {
                        MensajeOperario(
                            texto = actual.ultimoError!!.mensajeOperario,
                            tono = TonoMensaje.ERROR,
                        )
                    }
                }

                items(actual.pendientes, key = { it.idOperacion }) { pendiente ->
                    TarjetaPendiente(
                        pendiente = pendiente,
                        reintentando = actual.reintentandoId == pendiente.idOperacion,
                        alReintentar = { modelo.reintentar(pendiente) },
                        alDescartar = { modelo.descartar(pendiente) },
                    )
                }

                item {
                    Spacer(Modifier.height(8.dp))
                    BotonPrincipal(
                        texto = "Reintentar todo",
                        alPulsar = modelo::reintentarTodas,
                    )
                }
            }
        }
    }
}

@Composable
private fun TarjetaPendiente(
    pendiente: OperacionPendiente,
    reintentando: Boolean,
    alReintentar: () -> Unit,
    alDescartar: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = pendiente.paso.titulo,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = pendiente.descripcionOperario,
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Orden ${pendiente.codigoOrden} · intentos: ${pendiente.intentos}" +
                    if (pendiente.simulado) " · SIMULACIÓN" else "",
                style = MaterialTheme.typography.bodyMedium,
                color = TextoSecundario,
            )

            Spacer(Modifier.height(12.dp))

            Row(modifier = Modifier.fillMaxWidth()) {
                BotonPrincipal(
                    texto = "Reintentar",
                    alPulsar = alReintentar,
                    cargando = reintentando,
                    modificador = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                BotonSecundario(
                    texto = "Descartar",
                    alPulsar = alDescartar,
                    modificador = Modifier.weight(1f),
                )
            }

            Spacer(Modifier.height(8.dp))
            Text(
                text = "«Descartar» solo borra el aviso de este teléfono. No deshace nada de lo " +
                    "que ya se hizo. Úselo solo si el supervisor lo indica.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextoSecundario,
            )
        }
    }
}
