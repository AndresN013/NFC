package ec.marathon.nfcstudio.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ec.marathon.nfcstudio.domain.model.PasoProceso
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.TextoPrincipal
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado

/** Estado visual de un paso del flujo. */
enum class EstadoPaso { PENDIENTE, EN_CURSO, COMPLETADO, FALLIDO }

/**
 * Lista de pasos del flujo con su estado.
 *
 * Por que se muestra el flujo entero y no solo el paso actual: cuando algo falla,
 * lo primero que pregunta el supervisor es "¿hasta dónde llegó?". Si la pantalla
 * solo ensena el paso en curso, la respuesta depende de la memoria del operario.
 * Aqui se ve de un vistazo que el chip SI se grabó y que lo que falló fue el
 * aviso al sistema, que es una situacion completamente distinta.
 */
@Composable
fun IndicadorPasos(
    pasos: List<PasoProceso>,
    estados: Map<PasoProceso, EstadoPaso>,
    modificador: Modifier = Modifier,
) {
    Column(modifier = modificador.fillMaxWidth()) {
        pasos.forEach { paso ->
            FilaPaso(paso = paso, estado = estados[paso] ?: EstadoPaso.PENDIENTE)
        }
    }
}

@Composable
private fun FilaPaso(paso: PasoProceso, estado: EstadoPaso) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (estado) {
            EstadoPaso.COMPLETADO -> Icon(
                Icons.Filled.CheckCircle,
                contentDescription = "Completado",
                tint = VerdeAprobado,
                modifier = Modifier.size(28.dp),
            )

            EstadoPaso.EN_CURSO -> CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                strokeWidth = 3.dp,
            )

            EstadoPaso.FALLIDO -> Icon(
                Icons.Filled.Cancel,
                contentDescription = "Falló",
                tint = RojoRechazo,
                modifier = Modifier.size(28.dp),
            )

            EstadoPaso.PENDIENTE -> Icon(
                Icons.Filled.RadioButtonUnchecked,
                contentDescription = "Pendiente",
                tint = TextoSecundario,
                modifier = Modifier.size(28.dp),
            )
        }

        Text(
            text = paso.titulo,
            style = MaterialTheme.typography.bodyLarge,
            color = if (estado == EstadoPaso.PENDIENTE) TextoSecundario else TextoPrincipal,
            fontWeight = if (estado == EstadoPaso.EN_CURSO) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

/** Pasos que se muestran en la pantalla de programación, en orden. */
val PASOS_PROGRAMACION: List<PasoProceso> = listOf(
    PasoProceso.DETECCION,
    PasoProceso.INSPECCION,
    PasoProceso.CONSULTA_SERVIDOR,
    PasoProceso.RESERVA,
    PasoProceso.ESCRITURA,
    PasoProceso.RELECTURA,
)
