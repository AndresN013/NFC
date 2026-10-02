package ec.marathon.nfcstudio.ui.screens.verificacion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Nfc
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.core.RedactorDeSecretos
import ec.marathon.nfcstudio.domain.model.NivelConfianza
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.EfectoPantallaSegura
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.IconoResultado
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.AmbarAviso
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado

/**
 * Pantalla de verificación (control de calidad y formación).
 *
 * Lleva FLAG_SECURE porque muestra el resultado de leer un chip real.
 *
 * El texto de esta pantalla es deliberadamente incómodo: dice con todas las
 * letras que una lectura de NTAG 21x NO autentica. Si alguien busca una pantalla
 * que diga "jersey verificado" para una foto de marketing, no la va a encontrar
 * aquí mientras el chip no dé una prueba criptográfica de verdad.
 */
@Composable
fun PantallaVerificacion(
    modelo: VerificacionViewModel,
    modoSimulacion: Boolean,
    alVolver: () -> Unit,
) {
    EfectoPantallaSegura()

    val estado by modelo.estado.collectAsStateWithLifecycle()

    AndamioPlanta(
        titulo = "Verificar emblema",
        modoSimulacion = modoSimulacion,
        alVolver = alVolver,
    ) { modificador ->
        when (val actual = estado) {
            is VerificacionViewModel.EstadoUi.Leyendo ->
                CargandoPantalla("Leyendo el emblema…")

            is VerificacionViewModel.EstadoUi.Esperando -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconoResultado(Icons.Filled.Nfc, MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(20.dp))
                Text(
                    text = actual.mensaje,
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(24.dp))
                MensajeOperario(
                    texto = "Esta lectura es la misma que hará el teléfono de un cliente. " +
                        "Sirve para comprobar que el emblema responde y qué nivel de " +
                        "confianza produce de verdad.",
                    tono = TonoMensaje.INFORMACION,
                )
                if (actual.simulacion) {
                    Spacer(Modifier.height(24.dp))
                    BotonPrincipal(
                        texto = "Leer emblema simulado",
                        alPulsar = modelo::leerSimulado,
                    )
                }
            }

            is VerificacionViewModel.EstadoUi.Fallo -> Column(
                modifier = modificador
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconoResultado(Icons.Filled.ErrorOutline, RojoRechazo)
                Spacer(Modifier.height(16.dp))
                MensajeOperario(
                    texto = actual.mensajeOperario,
                    tono = TonoMensaje.ERROR,
                    titulo = "No se pudo leer",
                )
                Spacer(Modifier.height(24.dp))
                BotonPrincipal(texto = "Volver a intentar", alPulsar = modelo::volverAEsperar)
            }

            is VerificacionViewModel.EstadoUi.Leido -> {
                val lectura = actual.lectura
                val nivel = lectura.nivelLocal
                val (icono, tinte) = when (nivel) {
                    NivelConfianza.VERIFIED -> Icons.Filled.Verified to VerdeAprobado
                    NivelConfianza.IDENTIFIED_ONLY -> Icons.Filled.Verified to AmbarAviso
                    else -> Icons.Filled.ErrorOutline to RojoRechazo
                }

                Column(
                    modifier = modificador
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    IconoResultado(icono, tinte)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = nivel.titulo,
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = nivel.explicacionPlanta,
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextoSecundario,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(20.dp))

                    MensajeOperario(
                        texto = lectura.motivo,
                        tono = if (nivel == NivelConfianza.VERIFIED) {
                            TonoMensaje.EXITO
                        } else {
                            TonoMensaje.AVISO
                        },
                        titulo = "Por qué este resultado",
                    )

                    Spacer(Modifier.height(16.dp))

                    TarjetaSeccion(titulo = "Qué se leyó") {
                        FilaDato("Tipo de emblema", actual.tipoChip.etiquetaOperario)
                        FilaDato("Tecnologías", actual.tecnologias.joinToString(", "))
                        FilaDato(
                            "Identificador leído",
                            // Solo una huella: el identificador completo es el
                            // contenido del chip y no debe poder fotografiarse.
                            RedactorDeSecretos.huellaCorta(lectura.payload.token),
                        )
                        FilaDato(
                            "Comprobación de seguridad",
                            if (lectura.payload.authenticatedMessage != null) {
                                "El chip respondió"
                            } else {
                                "No disponible en este chip"
                            },
                            destacado = true,
                        )
                        FilaDato(
                            "Contador de lecturas",
                            lectura.payload.readCounter?.toString() ?: "El chip no lo expone",
                        )
                        FilaDato("Lectura simulada", if (lectura.simulado) "Sí" else "No")
                    }

                    Spacer(Modifier.height(16.dp))

                    MensajeOperario(
                        texto = "El resultado definitivo lo decide el sistema central, que " +
                            "conoce el historial de la unidad. Esta pantalla solo muestra lo " +
                            "que este teléfono puede comprobar por sí mismo.",
                        tono = TonoMensaje.INFORMACION,
                    )

                    Spacer(Modifier.height(24.dp))
                    BotonPrincipal(texto = "Leer otro emblema", alPulsar = modelo::volverAEsperar)
                    Spacer(Modifier.height(10.dp))
                    BotonSecundario(texto = "Volver", alPulsar = alVolver)
                }
            }
        }
    }
}
