package ec.marathon.nfcstudio.ui.screens.estadonfc

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Nfc
import androidx.compose.material.icons.filled.PhonelinkErase
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.core.RedactorDeSecretos
import ec.marathon.nfcstudio.nfc.EstadoNfcTelefono
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
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado

/**
 * Pantalla 2 del flujo: estado NFC del teléfono y autorización del puesto.
 *
 * Es la puerta que impide llegar a las órdenes con un teléfono que no puede
 * trabajar. Dejar pasar y fallar más tarde, con el emblema ya apoyado y el
 * jersey en la mesa, sería peor.
 */
@Composable
fun PantallaEstadoNfcTelefono(
    modelo: EstadoNfcViewModel,
    alContinuar: () -> Unit,
    alCerrarSesion: () -> Unit,
) {
    val estado by modelo.estado.collectAsStateWithLifecycle()
    val contexto = LocalContext.current

    when (val actual = estado) {
        is EstadoNfcViewModel.EstadoUi.Comprobando ->
            CargandoPantalla("Comprobando el teléfono…")

        is EstadoNfcViewModel.EstadoUi.Resuelto -> AndamioPlanta(
            titulo = "Estado del teléfono",
            modoSimulacion = actual.modoSimulacion,
        ) { modificador ->
            Column(
                modifier = modificador
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val (icono, tinte) = when {
                    actual.puedeProgramarReal -> Icons.Filled.CheckCircle to VerdeAprobado
                    actual.estadoNfc == EstadoNfcTelefono.SIN_HARDWARE ->
                        Icons.Filled.PhonelinkErase to RojoRechazo
                    !actual.dispositivoAutorizado -> Icons.Filled.PhonelinkErase to AmbarAviso
                    else -> Icons.Filled.Nfc to AmbarAviso
                }
                IconoResultado(icono, tinte)

                Spacer(Modifier.height(16.dp))

                Text(
                    text = if (actual.puedeProgramarReal) {
                        "Teléfono listo para programar"
                    } else {
                        actual.estadoNfc.titulo
                    },
                    style = MaterialTheme.typography.headlineSmall,
                )

                Spacer(Modifier.height(8.dp))

                Text(
                    text = actual.estadoNfc.instruccion,
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextoSecundario,
                )

                Spacer(Modifier.height(20.dp))

                if (actual.motivoBloqueo != null) {
                    MensajeOperario(
                        texto = actual.motivoBloqueo!!,
                        tono = TonoMensaje.AVISO,
                        titulo = "No se puede programar todavía",
                    )
                    Spacer(Modifier.height(16.dp))
                }

                TarjetaSeccion(titulo = "Datos del puesto") {
                    FilaDato("Operario", actual.nombreOperario)
                    FilaDato(
                        "Puesto",
                        actual.etiquetaDispositivo ?: "Sin nombre asignado",
                    )
                    FilaDato(
                        "Habilitado por el sistema",
                        if (actual.dispositivoAutorizado) "Sí" else "No",
                        destacado = true,
                    )
                    // Se muestra solo una huella del identificador: el valor
                    // completo no aporta nada al operario y aparecería en una foto
                    // de la pantalla.
                    FilaDato(
                        "Identificador del equipo",
                        RedactorDeSecretos.huellaCorta(actual.idDispositivo),
                    )
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Modo simulación") {
                    Text(
                        text = "Actívelo solo para practicar o para formar a alguien. " +
                            "Con el modo activo NO se graba ningún emblema y nada cuenta " +
                            "como producción.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                    Spacer(Modifier.height(12.dp))
                    Switch(
                        checked = actual.modoSimulacion,
                        onCheckedChange = modelo::cambiarModoSimulacion,
                    )
                }

                Spacer(Modifier.height(24.dp))

                if (actual.estadoNfc == EstadoNfcTelefono.APAGADO) {
                    BotonSecundario(
                        texto = "Abrir los ajustes de NFC",
                        alPulsar = {
                            // Intent del sistema documentado: lleva directo a los
                            // ajustes de NFC. Es preferible a explicar la ruta de
                            // menús, que cambia según el fabricante.
                            contexto.startActivity(Intent(Settings.ACTION_NFC_SETTINGS))
                        },
                    )
                    Spacer(Modifier.height(12.dp))
                    BotonSecundario(texto = "Ya lo activé, comprobar de nuevo", alPulsar = modelo::refrescar)
                    Spacer(Modifier.height(12.dp))
                }

                BotonPrincipal(
                    texto = if (actual.modoSimulacion && !actual.puedeProgramarReal) {
                        "Continuar en modo simulación"
                    } else {
                        "Continuar a las órdenes"
                    },
                    alPulsar = alContinuar,
                    habilitado = actual.puedeContinuar,
                )

                Spacer(Modifier.height(12.dp))

                BotonSecundario(texto = "Cerrar sesión", alPulsar = alCerrarSesion)
            }
        }
    }
}
