package ec.marathon.nfcstudio.ui.screens.configuracion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.CargandoPantalla
import ec.marathon.nfcstudio.ui.components.EfectoPantallaSegura
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.TextoSecundario

/**
 * Pantalla de configuración.
 *
 * Lleva FLAG_SECURE: muestra la dirección del servidor, el estado de la sesión y
 * el estado de la atestación del dispositivo. Nada de eso debería viajar en una
 * captura de pantalla ni quedar en la miniatura de recientes.
 *
 * OBSÉRVESE LO QUE NO ESTÁ: no hay campo de clave, ni de PIN de chip, ni de
 * "clave maestra del lote", ni importación de ficheros de claves. Ver el
 * comentario de cabecera de [ConfiguracionViewModel].
 */
@Composable
fun PantallaConfiguracion(
    modelo: ConfiguracionViewModel,
    alCerrarSesion: () -> Unit,
    alVolver: () -> Unit,
) {
    EfectoPantallaSegura()

    val estado by modelo.estado.collectAsStateWithLifecycle()

    when (val actual = estado) {
        is ConfiguracionViewModel.EstadoUi.Cargando ->
            CargandoPantalla("Cargando la configuración…")

        is ConfiguracionViewModel.EstadoUi.Cargada -> AndamioPlanta(
            titulo = "Configuración",
            modoSimulacion = actual.modoSimulacion,
            alVolver = alVolver,
        ) { modificador ->
            Column(
                modifier = modificador
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
            ) {
                TarjetaSeccion(titulo = "Sesión") {
                    FilaDato("Operario", actual.nombreOperario, destacado = true)
                    FilaDato("Le quedan", "${actual.minutosDeSesion} minutos")
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "La sesión caduca sola por seguridad. Cuando pase, vuelva a " +
                            "ingresar: no perderá nada de lo ya enviado.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Modo simulación") {
                    Text(
                        text = "Con el modo activo NO se graba ningún emblema. Todas las " +
                            "pantallas muestran un aviso naranja permanente y nada cuenta como " +
                            "producción.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                    Spacer(Modifier.height(12.dp))
                    Switch(
                        checked = actual.modoSimulacion,
                        onCheckedChange = modelo::cambiarModoSimulacion,
                    )
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Servidor") {
                    if (actual.urlEditable) {
                        OutlinedTextField(
                            value = actual.urlEnEdicion,
                            onValueChange = modelo::cambiarUrlEnEdicion,
                            label = { Text("Dirección del servidor") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(12.dp))
                        BotonSecundario(
                            texto = "Guardar y cerrar sesión",
                            alPulsar = modelo::guardarUrl,
                            habilitado = actual.urlCambiada,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "Editable solo en la versión de pruebas. En la versión de " +
                                "planta la dirección está fijada en la aplicación.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextoSecundario,
                        )
                    } else {
                        FilaDato("Dirección", actual.urlBase)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "No se puede cambiar desde el teléfono. Si necesita apuntar a " +
                                "otro servidor, pida la aplicación correspondiente al equipo de " +
                                "sistemas.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextoSecundario,
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Lector NFC") {
                    FilaDato("Estado", actual.estadoNfc.titulo, destacado = true)
                    Text(
                        text = actual.estadoNfc.instruccion,
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Seguridad del dispositivo") {
                    FilaDato("Comprobación de integridad", actual.nombreAtestacion)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = if (actual.atestacionDisponible) {
                            "Este teléfono demuestra al sistema que la aplicación no ha sido " +
                                "modificada."
                        } else {
                            "Pendiente: el sistema todavía no puede comprobar que esta " +
                                "aplicación no haya sido modificada. Está previsto para una " +
                                "fase posterior."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextoSecundario,
                    )
                }

                Spacer(Modifier.height(16.dp))

                // Transparencia deliberada: el estado de la integración de chips
                // seguros se muestra en la aplicación, no solo en la documentación,
                // para que nadie asuma que ya funciona.
                TarjetaSeccion(titulo = "Emblemas seguros (NTAG 424 DNA)") {
                    MensajeOperario(
                        texto = "La programación de emblemas seguros NO está implementada. Este " +
                            "equipo solo puede grabar emblemas estándar, que identifican el " +
                            "producto pero no lo autentican.",
                        tono = TonoMensaje.AVISO,
                    )
                    Spacer(Modifier.height(12.dp))
                    actual.pendientesNtag424.forEach { tarea ->
                        FilaDato(tarea.operacion, tarea.bloqueadaPor)
                    }
                }

                Spacer(Modifier.height(16.dp))

                TarjetaSeccion(titulo = "Aplicación") {
                    FilaDato("Versión", actual.versionApp)
                }

                Spacer(Modifier.height(24.dp))

                Text(
                    text = "Esta aplicación nunca guarda ni pide claves de chips. Si alguien le " +
                        "pide teclear una clave aquí, no lo haga y avise al supervisor.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextoSecundario,
                    fontWeight = FontWeight.SemiBold,
                )

                Spacer(Modifier.height(20.dp))

                BotonPrincipal(
                    texto = "Cerrar sesión",
                    alPulsar = {
                        modelo.cerrarSesion()
                        alCerrarSesion()
                    },
                )
            }
        }
    }
}
