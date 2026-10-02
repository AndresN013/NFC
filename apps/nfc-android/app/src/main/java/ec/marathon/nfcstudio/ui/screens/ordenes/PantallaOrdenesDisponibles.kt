package ec.marathon.nfcstudio.ui.screens.ordenes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.TextoSecundario

/**
 * Pantalla 3 del flujo: órdenes disponibles.
 *
 * Las órdenes que no admiten trabajo (completadas, canceladas, sin unidades
 * restantes) se muestran igualmente, en una sección aparte y sin poder
 * seleccionarse. Ocultarlas haría que el operario pensara que la lista no se
 * actualizó y la recargara una y otra vez.
 */
@Composable
fun PantallaOrdenesDisponibles(
    modelo: OrdenesViewModel,
    modoSimulacion: Boolean,
    alElegirOrden: (OrdenProduccion) -> Unit,
    alAbrirHistorial: () -> Unit,
    alAbrirPendientes: () -> Unit,
    alAbrirVerificacion: () -> Unit,
    alAbrirConfiguracion: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()

    AndamioPlanta(
        titulo = "Órdenes de producción",
        modoSimulacion = modoSimulacion,
        acciones = {
            IconButton(onClick = modelo::cargar) {
                Icon(Icons.Filled.Refresh, contentDescription = "Actualizar la lista")
            }
        },
    ) { modificador ->
        when (val actual = estado) {
            is OrdenesViewModel.EstadoUi.Cargando ->
                CargandoPantalla("Cargando órdenes…")

            is OrdenesViewModel.EstadoUi.Fallo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = actual.error.mensajeOperario,
                    tono = TonoMensaje.ERROR,
                    titulo = "No pudimos cargar las órdenes",
                )
                Spacer(Modifier.height(16.dp))
                BotonSecundario(texto = "Reintentar", alPulsar = modelo::cargar)
            }

            is OrdenesViewModel.EstadoUi.Vacia -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(texto = actual.mensaje, tono = TonoMensaje.INFORMACION)
                Spacer(Modifier.height(16.dp))
                BotonSecundario(texto = "Actualizar", alPulsar = modelo::cargar)
            }

            is OrdenesViewModel.EstadoUi.Listas -> LazyColumn(
                modifier = modificador
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 16.dp),
            ) {
                if (actual.recargando) {
                    item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
                }

                item {
                    Text(
                        text = "Elija la orden en la que va a trabajar",
                        style = MaterialTheme.typography.titleMedium,
                    )
                }

                items(actual.trabajables, key = { it.id }) { orden ->
                    TarjetaOrden(orden = orden, alPulsar = { alElegirOrden(orden) })
                }

                if (actual.cerradas.isNotEmpty()) {
                    item {
                        Text(
                            text = "Órdenes cerradas o sin unidades pendientes",
                            style = MaterialTheme.typography.titleMedium,
                            color = TextoSecundario,
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                    items(actual.cerradas, key = { it.id }) { orden ->
                        TarjetaOrden(orden = orden, alPulsar = null)
                    }
                }

                item {
                    Spacer(Modifier.height(8.dp))
                    BotonSecundario(
                        texto = "Verificar un emblema (control de calidad)",
                        alPulsar = alAbrirVerificacion,
                    )
                    Spacer(Modifier.height(8.dp))
                    BotonSecundario(texto = "Mi historial del turno", alPulsar = alAbrirHistorial)
                    Spacer(Modifier.height(8.dp))
                    BotonSecundario(texto = "Pendientes de enviar", alPulsar = alAbrirPendientes)
                    Spacer(Modifier.height(8.dp))
                    BotonSecundario(texto = "Configuración", alPulsar = alAbrirConfiguracion)
                }
            }
        }
    }
}

@Composable
private fun TarjetaOrden(orden: OrdenProduccion, alPulsar: (() -> Unit)?) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (alPulsar != null) Modifier.clickable(onClick = alPulsar) else Modifier),
        colors = CardDefaults.cardColors(
            containerColor = if (alPulsar != null) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = orden.codigo,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "${orden.unidadesRestantes} por hacer",
                    style = MaterialTheme.typography.titleMedium,
                    color = TextoSecundario,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "${orden.nombreClub} · ${orden.nombreTemporada}",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = orden.nombreModelo,
                style = MaterialTheme.typography.bodyMedium,
                color = TextoSecundario,
            )
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { orden.progreso },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "${orden.unidadesHechas} de ${orden.unidadesPlanificadas} terminadas · " +
                    "lote ${orden.codigoLote}",
                style = MaterialTheme.typography.bodyMedium,
                color = TextoSecundario,
            )
        }
    }
}
