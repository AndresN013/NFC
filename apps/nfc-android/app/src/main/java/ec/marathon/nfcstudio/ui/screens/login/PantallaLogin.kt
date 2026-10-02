package ec.marathon.nfcstudio.ui.screens.login

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
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.EfectoPantallaSegura
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.TextoSecundario

/**
 * Pantalla 1 del flujo: ingreso del operario.
 *
 * Es el primer paso del flujo obligatorio. Nada de lo que sigue (ver órdenes,
 * apoyar un emblema, grabar) esta accesible sin una sesion valida, y la
 * comprobacion no es solo de navegacion: cada peticion lleva el token y el
 * servidor la rechaza sin el.
 */
@Composable
fun PantallaLogin(
    modelo: LoginViewModel,
    modoSimulacion: Boolean,
    alIngresar: () -> Unit,
) {
    // FLAG_SECURE: el correo del operario es dato personal y no debe acabar en
    // la miniatura de aplicaciones recientes que el sistema guarda en disco.
    EfectoPantallaSegura()

    val estado by modelo.estado.collectAsStateWithLifecycle()
    var mostrarContrasena by remember { mutableStateOf(false) }

    LaunchedEffect(estado) {
        if (estado is LoginViewModel.EstadoLogin.Ingresado) alIngresar()
    }

    AndamioPlanta(titulo = "Marathon NFC Studio", modoSimulacion = modoSimulacion) { modificador ->
        Column(
            modifier = modificador
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
        ) {
            Text(
                text = "Ingrese con su usuario de planta",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Use el correo que le asignó el supervisor. Si no recuerda la " +
                    "contraseña, acuda a él: nadie más puede restablecerla.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextoSecundario,
                modifier = Modifier.padding(top = 8.dp),
            )

            Spacer(Modifier.height(24.dp))

            when (val actual = estado) {
                is LoginViewModel.EstadoLogin.Formulario -> {
                    if (actual.error != null) {
                        MensajeOperario(
                            texto = actual.error.mensajeOperario,
                            tono = TonoMensaje.ERROR,
                            titulo = "No pudimos ingresar",
                        )
                        Spacer(Modifier.height(16.dp))
                    }

                    OutlinedTextField(
                        value = actual.correo,
                        onValueChange = modelo::cambiarCorreo,
                        label = { Text("Correo de trabajo") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Next,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = actual.contrasena,
                        onValueChange = modelo::cambiarContrasena,
                        label = { Text("Contraseña") },
                        singleLine = true,
                        visualTransformation = if (mostrarContrasena) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        trailingIcon = {
                            // Ver la contrasena es necesario: escribir a ciegas con
                            // guantes produce mas bloqueos de cuenta que ayuda.
                            IconButton(onClick = { mostrarContrasena = !mostrarContrasena }) {
                                Icon(
                                    imageVector = if (mostrarContrasena) {
                                        Icons.Filled.VisibilityOff
                                    } else {
                                        Icons.Filled.Visibility
                                    },
                                    contentDescription = if (mostrarContrasena) {
                                        "Ocultar contraseña"
                                    } else {
                                        "Mostrar contraseña"
                                    },
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(Modifier.height(32.dp))

                    BotonPrincipal(
                        texto = "Ingresar",
                        alPulsar = modelo::ingresar,
                        habilitado = actual.puedeEnviar,
                    )
                }

                is LoginViewModel.EstadoLogin.Enviando -> {
                    BotonPrincipal(texto = "", alPulsar = {}, cargando = true)
                    Text(
                        text = "Comprobando sus datos…",
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextoSecundario,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }

                is LoginViewModel.EstadoLogin.Ingresado -> {
                    MensajeOperario(
                        texto = "Bienvenido, ${actual.sesion.nombreMostrable}.",
                        tono = TonoMensaje.EXITO,
                    )
                }
            }

            Spacer(Modifier.height(32.dp))

            Text(
                text = "Su sesión dura un turno y luego caduca por seguridad. " +
                    "La aplicación nunca guarda su contraseña.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextoSecundario,
            )
        }
    }
}
