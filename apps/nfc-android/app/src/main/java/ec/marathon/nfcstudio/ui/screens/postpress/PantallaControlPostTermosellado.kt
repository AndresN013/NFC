package ec.marathon.nfcstudio.ui.screens.postpress

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.ReportProblem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.IconoResultado
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado

/**
 * Pantalla 7 y última del flujo: control tras el termosellado.
 *
 * La prensa aplica calor y presión sobre el emblema. Esta lectura comprueba que
 * el chip sobrevivió Y que su contenido sigue siendo el correcto. El resultado es
 * binario: activar o cuarentena.
 */
@Composable
fun PantallaControlPostTermosellado(
    modelo: ControlPostTermoselladoViewModel,
    modoSimulacion: Boolean,
    alVolverAOrdenes: () -> Unit,
    alSiguienteUnidad: () -> Unit,
    alAbrirCuarentena: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()

    AndamioPlanta(
        titulo = "Control tras la prensa",
        modoSimulacion = modoSimulacion,
    ) { modificador ->
        when (val actual = estado) {
            is ControlPostTermoselladoViewModel.EstadoUi.SinUnidad -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = "No hay una unidad pendiente de control. Empiece por programar y " +
                        "unir un emblema.",
                    tono = TonoMensaje.AVISO,
                )
                Spacer(Modifier.height(16.dp))
                BotonSecundario(texto = "Volver a las órdenes", alPulsar = alVolverAOrdenes)
            }

            is ControlPostTermoselladoViewModel.EstadoUi.Comprobando ->
                CargandoPantalla("Comprobando el emblema tras la prensa…")

            is ControlPostTermoselladoViewModel.EstadoUi.Esperando -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconoResultado(
                    Icons.Filled.LocalFireDepartment,
                    MaterialTheme.colorScheme.secondary,
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    text = actual.mensaje,
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                )

                Spacer(Modifier.height(20.dp))

                TarjetaSeccion(titulo = "Unidad") {
                    FilaDato("Referencia", actual.referenciaPublica, destacado = true)
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Datos de la prensa (opcionales)") {
                    Text(
                        text = "Si los tiene a mano, anótelos. Sirven para localizar el " +
                            "problema si mañana aparecen varias unidades falladas del mismo " +
                            "turno. Puede dejarlos en blanco.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = actual.temperatura,
                            onValueChange = modelo::cambiarTemperatura,
                            label = { Text("°C") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        OutlinedTextField(
                            value = actual.presion,
                            onValueChange = modelo::cambiarPresion,
                            label = { Text("bar") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        OutlinedTextField(
                            value = actual.duracion,
                            onValueChange = modelo::cambiarDuracion,
                            label = { Text("seg") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                if (actual.simulacion) {
                    Spacer(Modifier.height(24.dp))
                    BotonPrincipal(
                        texto = "Comprobar emblema simulado (correcto)",
                        alPulsar = { modelo.comprobarSimulado() },
                    )
                    Spacer(Modifier.height(10.dp))
                    BotonSecundario(
                        texto = "Simular emblema que ya no responde",
                        alPulsar = { modelo.comprobarSimulado(fallarLectura = true) },
                    )
                }
            }

            is ControlPostTermoselladoViewModel.EstadoUi.Fallo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = actual.error.mensajeOperario,
                    tono = TonoMensaje.ERROR,
                    titulo = "No pudimos registrar el control",
                )
                Spacer(Modifier.height(16.dp))
                MensajeOperario(
                    texto = "La unidad ${actual.referenciaPublica} NO debe salir de la mesa " +
                        "hasta que el control quede registrado. Reintente cuando haya red.",
                    tono = TonoMensaje.AVISO,
                )
                Spacer(Modifier.height(20.dp))
                BotonPrincipal(texto = "Reintentar", alPulsar = modelo::volverAEsperar)
            }

            is ControlPostTermoselladoViewModel.EstadoUi.Resuelto -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconoResultado(
                    if (actual.aprobado) Icons.Filled.CheckCircle else Icons.Filled.ReportProblem,
                    if (actual.aprobado) VerdeAprobado else RojoRechazo,
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    text = if (actual.aprobado) "Unidad aprobada" else "Unidad en cuarentena",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                MensajeOperario(
                    texto = actual.mensajeOperario,
                    tono = if (actual.aprobado) TonoMensaje.EXITO else TonoMensaje.ERROR,
                )

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Detalle") {
                    FilaDato("Estado final", actual.estadoFinal, destacado = true)
                    FilaDato("Resultado de la lectura", actual.detalleTecnico)
                }

                Spacer(Modifier.height(24.dp))

                BotonPrincipal(
                    texto = "Siguiente unidad",
                    alPulsar = {
                        modelo.siguienteUnidad()
                        alSiguienteUnidad()
                    },
                )
                Spacer(Modifier.height(10.dp))
                if (!actual.aprobado) {
                    BotonSecundario(
                        texto = "Ver la ficha de cuarentena",
                        alPulsar = alAbrirCuarentena,
                    )
                    Spacer(Modifier.height(10.dp))
                }
                BotonSecundario(texto = "Volver a las órdenes", alPulsar = alVolverAOrdenes)
            }
        }
    }
}
