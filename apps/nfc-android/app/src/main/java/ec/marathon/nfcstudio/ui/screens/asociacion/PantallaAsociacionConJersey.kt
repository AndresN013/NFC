package ec.marathon.nfcstudio.ui.screens.asociacion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
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
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado

/**
 * Pantalla 6 del flujo: unir el emblema con el jersey.
 *
 * El campo de código de jersey recibe el foco automáticamente para que un lector
 * de códigos de barras externo (que se comporta como teclado) escriba en él sin
 * que el operario tenga que tocar la pantalla con guantes.
 */
@Composable
fun PantallaAsociacionConJersey(
    modelo: AsociacionViewModel,
    modoSimulacion: Boolean,
    alPasarAPostTermosellado: () -> Unit,
    alVolver: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()
    val foco = remember { FocusRequester() }

    AndamioPlanta(
        titulo = "Unir emblema y jersey",
        modoSimulacion = modoSimulacion,
        alVolver = alVolver,
    ) { modificador ->
        when (val actual = estado) {
            is AsociacionViewModel.EstadoUi.SinTrabajo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = "No hay un emblema grabado pendiente de unir. Vuelva atrás y " +
                        "empiece por programar el emblema.",
                    tono = TonoMensaje.AVISO,
                )
            }

            is AsociacionViewModel.EstadoUi.Enviando ->
                CargandoPantalla("Registrando la unión…")

            is AsociacionViewModel.EstadoUi.Capturando -> {
                LaunchedEffect(Unit) { runCatching { foco.requestFocus() } }

                Column(
                    modifier = modificador
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                ) {
                    Text(
                        text = "Escanee o escriba los códigos",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "El emblema ya está grabado y comprobado. Falta decirle al " +
                            "sistema en qué jersey va.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                        modifier = Modifier.padding(top = 8.dp),
                    )

                    Spacer(Modifier.height(20.dp))

                    TarjetaSeccion(titulo = "Orden en curso") {
                        FilaDato("Orden", actual.orden.codigo, destacado = true)
                        FilaDato("Modelo", actual.orden.nombreModelo)
                        if (actual.orden.codigoSku.isNotBlank()) {
                            FilaDato("Código de producto", actual.orden.codigoSku)
                        }
                    }

                    Spacer(Modifier.height(20.dp))

                    OutlinedTextField(
                        value = actual.codigoEmblema,
                        onValueChange = modelo::cambiarCodigoEmblema,
                        label = { Text("Código del emblema") },
                        supportingText = {
                            Text("Está impreso en el sobre o en la hoja del lote.")
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = actual.codigoJersey,
                        onValueChange = modelo::cambiarCodigoJersey,
                        label = { Text("Código de barras del jersey") },
                        supportingText = {
                            Text("Apunte el lector al código de la etiqueta interior.")
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.Characters,
                            imeAction = ImeAction.Done,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(foco),
                    )

                    if (actual.error != null) {
                        Spacer(Modifier.height(16.dp))
                        MensajeOperario(
                            texto = actual.error!!.mensajeOperario,
                            tono = TonoMensaje.ERROR,
                        )
                    }

                    Spacer(Modifier.height(28.dp))

                    BotonPrincipal(
                        texto = "Unir emblema y jersey",
                        alPulsar = modelo::vincular,
                        habilitado = actual.puedeVincular,
                    )
                }
            }

            is AsociacionViewModel.EstadoUi.Fallo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
            ) {
                MensajeOperario(
                    texto = actual.error.mensajeOperario,
                    tono = TonoMensaje.ERROR,
                    titulo = "No se pudo registrar la unión",
                )
                Spacer(Modifier.height(16.dp))
                MensajeOperario(
                    texto = "El emblema SÍ está grabado. Si reintenta, el sistema reconocerá " +
                        "que es el mismo intento y no duplicará nada.",
                    tono = TonoMensaje.INFORMACION,
                )
                Spacer(Modifier.height(20.dp))
                BotonPrincipal(texto = "Reintentar", alPulsar = modelo::reintentar)
                Spacer(Modifier.height(10.dp))
                BotonSecundario(texto = "Volver", alPulsar = alVolver)
            }

            is AsociacionViewModel.EstadoUi.Vinculada -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconoResultado(Icons.Filled.Link, VerdeAprobado)
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "Unidad registrada",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = if (actual.listoParaPrensa) {
                        "La unidad queda LISTA PARA LA PRENSA. Colóquela en el carro de " +
                            "termosellado."
                    } else {
                        "La unidad quedó unida, pero el sistema no confirmó el paso a «listo " +
                            "para la prensa». Avise al supervisor antes de prensarla."
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextoSecundario,
                    textAlign = TextAlign.Center,
                )

                Spacer(Modifier.height(20.dp))

                TarjetaSeccion(titulo = "Referencia de la unidad") {
                    // La referencia pública NO es secreta (va impresa en la
                    // etiqueta del producto), por eso sí se muestra completa.
                    FilaDato("Referencia", actual.unidad.referenciaPublica, destacado = true)
                }

                if (!actual.listoParaPrensa) {
                    Spacer(Modifier.height(16.dp))
                    MensajeOperario(
                        texto = "PENDIENTE DE CONTRATO: el sistema no expone todavía una " +
                            "operación específica para marcar «listo para la prensa». Se asume " +
                            "que ocurre al unir la unidad.",
                        tono = TonoMensaje.AVISO,
                    )
                }

                Spacer(Modifier.height(24.dp))

                BotonPrincipal(
                    texto = "Continuar al control tras la prensa",
                    alPulsar = alPasarAPostTermosellado,
                )
            }
        }
    }
}
