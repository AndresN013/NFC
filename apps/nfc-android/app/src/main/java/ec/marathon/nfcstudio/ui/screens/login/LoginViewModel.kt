package ec.marathon.nfcstudio.ui.screens.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.RepositorioAutenticacion
import ec.marathon.nfcstudio.data.session.PreferenciasApp
import ec.marathon.nfcstudio.data.session.SesionOperario
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * ViewModel de la pantalla de ingreso.
 *
 * SEGURIDAD: la contrasena vive en [EstadoLogin.Formulario.contrasena] mientras
 * el operario la escribe y se descarta en cuanto la peticion sale. No se guarda
 * en DataStore, no se guarda en el almacen cifrado y no se restaura al volver a
 * la pantalla. El correo SI se recuerda, porque teclearlo con guantes es lento y
 * no es una credencial por si solo.
 */
class LoginViewModel(
    private val repositorio: RepositorioAutenticacion,
    private val preferencias: PreferenciasApp,
) : ViewModel() {

    /** Estados posibles de la pantalla. Sellado: no hay terceros estados. */
    sealed interface EstadoLogin {

        data class Formulario(
            val correo: String = "",
            val contrasena: String = "",
            val error: ErrorApp? = null,
        ) : EstadoLogin {
            val puedeEnviar: Boolean
                get() = correo.contains('@') && correo.length >= 5 && contrasena.length >= 8
        }

        data class Enviando(val correo: String) : EstadoLogin

        data class Ingresado(val sesion: SesionOperario) : EstadoLogin
    }

    private val _estado = MutableStateFlow<EstadoLogin>(EstadoLogin.Formulario())
    val estado: StateFlow<EstadoLogin> = _estado.asStateFlow()

    init {
        viewModelScope.launch {
            val correoRecordado = preferencias.ultimoCorreo.first()
            val actual = _estado.value
            if (actual is EstadoLogin.Formulario && correoRecordado.isNotBlank()) {
                _estado.value = actual.copy(correo = correoRecordado)
            }
        }
    }

    fun cambiarCorreo(valor: String) {
        val actual = _estado.value
        if (actual is EstadoLogin.Formulario) {
            _estado.value = actual.copy(correo = valor.trim(), error = null)
        }
    }

    fun cambiarContrasena(valor: String) {
        val actual = _estado.value
        if (actual is EstadoLogin.Formulario) {
            _estado.value = actual.copy(contrasena = valor, error = null)
        }
    }

    fun ingresar() {
        val actual = _estado.value
        if (actual !is EstadoLogin.Formulario || !actual.puedeEnviar) return

        _estado.value = EstadoLogin.Enviando(actual.correo)

        viewModelScope.launch {
            when (val resultado = repositorio.iniciarSesion(actual.correo, actual.contrasena)) {
                is Resultado.Exito -> _estado.value = EstadoLogin.Ingresado(resultado.valor)
                is Resultado.Fallo -> _estado.value = EstadoLogin.Formulario(
                    correo = actual.correo,
                    // La contrasena NO se conserva tras un fallo: obligar a
                    // reescribirla evita que un telefono desatendido quede con la
                    // credencial a medio camino en el campo de texto.
                    contrasena = "",
                    error = resultado.error,
                )
            }
        }
    }
}
