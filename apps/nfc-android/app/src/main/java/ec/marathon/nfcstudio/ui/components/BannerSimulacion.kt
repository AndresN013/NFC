package ec.marathon.nfcstudio.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Science
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ec.marathon.nfcstudio.ui.theme.NaranjaSimulacion
import ec.marathon.nfcstudio.ui.theme.TextoPrincipal

/**
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Modo demostracion sin NFC, visiblemente        #
 * # etiquetado como SIMULACION con un banner permanente".                   #
 * ###########################################################################
 *
 * Banner PERMANENTE. No se puede cerrar, no se desvanece, no se encoge al hacer
 * scroll y ocupa el ancho completo en la parte superior de TODAS las pantallas
 * mientras el modo simulacion este activo.
 *
 * Por que tan insistente: el fallo que este banner previene es que alguien
 * ejecute una tanda de practica creyendo que es produccion (o al contrario) y
 * que unidades sin programar salgan contadas como buenas. Ese error solo se
 * descubre cuando el jersey esta en la tienda. Un aviso discreto que se puede
 * cerrar no sirve para eso.
 *
 * Usa el naranja [NaranjaSimulacion], reservado en exclusiva para este banner:
 * ningun otro elemento de la aplicacion lo utiliza, de modo que su presencia en
 * pantalla significa una sola cosa.
 */
@Composable
fun BannerSimulacion(
    modificador: Modifier = Modifier,
    detalle: String? = null,
) {
    Column(
        modifier = modificador
            .fillMaxWidth()
            .background(NaranjaSimulacion)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(
                imageVector = Icons.Filled.Science,
                contentDescription = null,
                tint = TextoPrincipal,
                modifier = Modifier.size(24.dp),
            )
            Text(
                text = "  MODO SIMULACIÓN — NO ES PRODUCCIÓN REAL",
                color = TextoPrincipal,
                fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center,
            )
        }
        Text(
            text = detalle
                ?: "Ningún emblema se está grabando. Nada de lo que haga aquí cuenta " +
                "como unidad producida ni autentica ningún jersey.",
            color = TextoPrincipal,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
        )
    }
}
