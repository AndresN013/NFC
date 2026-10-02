package ec.marathon.nfcstudio.ui.screens.cuarentena

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.domain.model.MotivoCuarentena
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.IconoResultado
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.AmbarAviso
import ec.marathon.nfcstudio.ui.theme.TextoSecundario

/**
 * Pantalla de cuarentena.
 *
 * Accesible desde cualquier punto del flujo en el que algo va mal. El texto
 * insiste en la acción física (la caja roja, anotar la orden) porque el registro
 * en el sistema no sirve de nada si el jersey sigue en el carro de producción.
 */
@Composable
fun PantallaCuarentena(
    modelo: CuarentenaViewModel,
    modoSimulacion: Boolean,
    alTerminar: () -> Unit,
    alVolver: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()

    AndamioPlanta(
        titulo = "Apartar unidad (cuarentena)",
        modoSimulacion = modoSimulacion,
        alVolver = alVolver,
    ) { modificador ->
        when (val actual = estado) {
            is CuarentenaViewModel.EstadoUi.Enviando ->
                CargandoPantalla("Registrando la cuarentena…")

            is CuarentenaViewModel.EstadoUi.Formulario -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = "Apartar una unidad nunca es un problema. Si tiene dudas sobre este " +
                        "emblema o este jersey, apártelo: es lo correcto.",
                    tono = TonoMensaje.INFORMACION,
                )

                Spacer(Modifier.height(20.dp))

                if (actual.referenciaPublica != null) {
                    TarjetaSeccion(titulo = "Unidad") {
                        FilaDato("Referencia", actual.referenciaPublica!!, destacado = true)
                    }
                    Spacer(Modifier.height(16.dp))
                } else {
                    MensajeOperario(
                        texto = "Esta unidad todavía no está registrada en el sistema, así que " +
                            "solo queda anotada en este teléfono. Entregue el emblema al " +
                            "supervisor con la hoja de la orden.",
                        tono = TonoMensaje.AVISO,
                    )
                    Spacer(Modifier.height(16.dp))
                }

                Text(
                    text = "¿Qué ocurrió?",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(8.dp))

                MotivoCuarentena.entries.forEach { motivo ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = actual.motivo == motivo,
                                onClick = { modelo.elegirMotivo(motivo) },
                            )
                            .padding(vertical = 4.dp),
                    ) {
                        androidx.compose.foundation.layout.Row(
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = actual.motivo == motivo,
                                onClick = { modelo.elegirMotivo(motivo) },
                            )
                            Text(
                                text = motivo.etiqueta,
                                style = MaterialTheme.typography.bodyLarge,
                                modifier = Modifier.padding(start = 4.dp),
                            )
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                OutlinedTextField(
                    value = actual.nota,
                    onValueChange = modelo::cambiarNota,
                    label = { Text("Nota para el supervisor (opcional)") },
                    supportingText = { Text("Máximo 200 caracteres.") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )

                if (actual.error != null) {
                    Spacer(Modifier.height(16.dp))
                    MensajeOperario(
                        texto = actual.error!!.mensajeOperario,
                        tono = TonoMensaje.ERROR,
                    )
                }

                Spacer(Modifier.height(24.dp))

                BotonPrincipal(
                    texto = "Apartar esta unidad",
                    alPulsar = modelo::enviar,
                    habilitado = actual.puedeEnviar,
                    color = AmbarAviso,
                )
            }

            is CuarentenaViewModel.EstadoUi.Fallo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = actual.error.mensajeOperario,
                    tono = TonoMensaje.ERROR,
                    titulo = "No se pudo registrar en el sistema",
                )
                Spacer(Modifier.height(16.dp))
                MensajeOperario(
                    texto = "APARTE LA UNIDAD FÍSICAMENTE DE TODOS MODOS. El registro puede " +
                        "esperar; que el jersey siga en la línea, no.",
                    tono = TonoMensaje.AVISO,
                )
                Spacer(Modifier.height(20.dp))
                BotonPrincipal(texto = "Reintentar", alPulsar = modelo::reintentar)
                Spacer(Modifier.height(10.dp))
                BotonSecundario(
                    texto = "Continuar con otra unidad",
                    alPulsar = {
                        modelo.siguienteUnidad()
                        alTerminar()
                    },
                )
            }

            is CuarentenaViewModel.EstadoUi.Registrada -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconoResultado(Icons.Filled.Inventory2, AmbarAviso)
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "Unidad apartada",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(12.dp))
                MensajeOperario(
                    texto = "Coloque la unidad en la CAJA ROJA de cuarentena y anote en la hoja " +
                        "el número de orden y el motivo: «${actual.motivo.etiqueta}».",
                    tono = TonoMensaje.AVISO,
                    titulo = "Qué hacer ahora",
                )
                if (actual.soloLocal) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = "Solo quedó anotado en este teléfono porque la unidad aún no " +
                            "existía en el sistema.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                }
                Spacer(Modifier.height(24.dp))
                BotonPrincipal(
                    texto = "Continuar con la siguiente unidad",
                    alPulsar = {
                        modelo.siguienteUnidad()
                        alTerminar()
                    },
                )
            }
        }
    }
}
