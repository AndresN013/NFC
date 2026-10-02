package ec.marathon.nfcstudio.ui.screens.detalleorden

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.domain.model.TipoChip
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.TextoSecundario

/**
 * Pantalla 4 del flujo: ficha de la orden.
 *
 * Muestra modelo, club, temporada y lote en grande, para comparar con la etiqueta
 * física de la caja de emblemas antes de tocar nada.
 */
@Composable
fun PantallaDetalleOrden(
    modelo: DetalleOrdenViewModel,
    modoSimulacion: Boolean,
    alEmpezar: () -> Unit,
    alVolver: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()

    AndamioPlanta(
        titulo = "Detalle de la orden",
        modoSimulacion = modoSimulacion,
        alVolver = alVolver,
    ) { modificador ->
        when (val actual = estado) {
            is DetalleOrdenViewModel.EstadoUi.Cargando ->
                CargandoPantalla("Cargando la orden…")

            is DetalleOrdenViewModel.EstadoUi.Fallo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = actual.error.mensajeOperario,
                    tono = TonoMensaje.ERROR,
                    titulo = "No pudimos abrir la orden",
                )
                Spacer(Modifier.height(16.dp))
                BotonSecundario(texto = "Reintentar", alPulsar = modelo::cargar)
            }

            is DetalleOrdenViewModel.EstadoUi.Cargada -> {
                val orden = actual.orden
                Column(
                    modifier = modificador
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                ) {
                    Text(
                        text = orden.codigo,
                        style = MaterialTheme.typography.displaySmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Compare estos datos con la etiqueta de la caja de emblemas " +
                            "antes de empezar.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                        modifier = Modifier.padding(top = 8.dp),
                    )

                    Spacer(Modifier.height(20.dp))

                    TarjetaSeccion(titulo = "Qué se va a producir") {
                        FilaDato("Club", orden.nombreClub, destacado = true)
                        FilaDato("Temporada", orden.nombreTemporada, destacado = true)
                        FilaDato("Modelo", orden.nombreModelo, destacado = true)
                        FilaDato("Lote de emblemas", orden.codigoLote, destacado = true)
                        if (orden.tipoChipEsperado != TipoChip.UNKNOWN) {
                            FilaDato("Tipo de emblema", orden.tipoChipEsperado.etiquetaOperario)
                        }
                        if (orden.codigoSku.isNotBlank()) {
                            FilaDato("Código de producto", orden.codigoSku)
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    TarjetaSeccion(titulo = "Avance") {
                        FilaDato("Planificadas", orden.unidadesPlanificadas.toString())
                        FilaDato("Terminadas", orden.unidadesHechas.toString())
                        FilaDato("Faltan", orden.unidadesRestantes.toString(), destacado = true)
                        Spacer(Modifier.height(10.dp))
                        LinearProgressIndicator(
                            progress = { orden.progreso },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    Spacer(Modifier.height(24.dp))

                    if (!actual.puedeEmpezar) {
                        MensajeOperario(
                            texto = "Esta orden no admite más unidades. Vuelva a la lista y " +
                                "elija otra.",
                            tono = TonoMensaje.AVISO,
                        )
                        Spacer(Modifier.height(16.dp))
                    }

                    BotonPrincipal(
                        texto = "Empezar a programar",
                        alPulsar = { if (modelo.empezar()) alEmpezar() },
                        habilitado = actual.puedeEmpezar,
                    )

                    Spacer(Modifier.height(12.dp))

                    Text(
                        text = "En la siguiente pantalla se le pedirá apoyar el emblema. " +
                            "Tenga el jersey a mano: después habrá que escanear su código.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                }
            }
        }
    }
}
