package ec.marathon.nfcstudio.ui.screens.programacion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Nfc
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
import ec.marathon.nfcstudio.domain.model.TipoChip
import ec.marathon.nfcstudio.ui.components.AndamioPlanta
import ec.marathon.nfcstudio.ui.components.BotonPrincipal
import ec.marathon.nfcstudio.ui.components.BotonSecundario
import ec.marathon.nfcstudio.ui.components.EfectoPantallaSegura
import ec.marathon.nfcstudio.ui.components.FilaDato
import ec.marathon.nfcstudio.ui.components.IconoResultado
import ec.marathon.nfcstudio.ui.components.IndicadorPasos
import ec.marathon.nfcstudio.ui.components.MensajeOperario
import ec.marathon.nfcstudio.ui.components.PASOS_PROGRAMACION
import ec.marathon.nfcstudio.ui.components.TarjetaSeccion
import ec.marathon.nfcstudio.ui.components.TonoMensaje
import ec.marathon.nfcstudio.ui.theme.AmbarAviso
import ec.marathon.nfcstudio.ui.theme.RojoRechazo
import ec.marathon.nfcstudio.ui.theme.TextoSecundario
import ec.marathon.nfcstudio.ui.theme.VerdeAprobado

/**
 * Pantalla 5 del flujo: programación del emblema.
 *
 * ###########################################################################
 * # NOTA DE SEGURIDAD SOBRE ESTA PANTALLA                                   #
 * ###########################################################################
 *
 *  - Lleva FLAG_SECURE: muestra información del chip y de la unidad que no debe
 *    poder capturarse ni quedar en la miniatura de recientes.
 *  - NO muestra la URI completa que se graba, ni el UID completo: solo confirma
 *    que la comprobación cuadró. El operario no necesita ese dato para trabajar,
 *    y mostrarlo lo convierte en algo fotografiable.
 *  - NO existe ningún campo de entrada de claves. Ni aquí ni en ninguna pantalla.
 */
@Composable
fun PantallaProgramacion(
    modelo: ProgramacionViewModel,
    alPasarAVincular: () -> Unit,
    alAbrirCuarentena: () -> Unit,
    alVolver: () -> Unit,
) {
    EfectoPantallaSegura()

    val estado by modelo.estado.collectAsStateWithLifecycle()

    val simulacion = when (val actual = estado) {
        is ProgramacionViewModel.EstadoUi.Esperando -> actual.simulacion
        is ProgramacionViewModel.EstadoUi.EnCurso -> actual.simulacion
        is ProgramacionViewModel.EstadoUi.Completada -> actual.simulacion
        is ProgramacionViewModel.EstadoUi.Fallo -> actual.simulacion
        ProgramacionViewModel.EstadoUi.SinOrden -> false
    }

    AndamioPlanta(
        titulo = "Programar emblema",
        modoSimulacion = simulacion,
        alVolver = alVolver,
    ) { modificador ->
        Column(
            modifier = modificador
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (val actual = estado) {
                ProgramacionViewModel.EstadoUi.SinOrden -> MensajeOperario(
                    texto = "No hay ninguna orden seleccionada. Vuelva atrás y elija una.",
                    tono = TonoMensaje.AVISO,
                )

                is ProgramacionViewModel.EstadoUi.Esperando -> {
                    IconoResultado(Icons.Filled.Nfc, MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(20.dp))
                    Text(
                        text = actual.mensaje,
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(24.dp))
                    TarjetaSeccion(titulo = "Orden en curso") {
                        FilaDato("Orden", actual.orden.codigo, destacado = true)
                        FilaDato("Club", actual.orden.nombreClub)
                        FilaDato("Modelo", actual.orden.nombreModelo)
                        FilaDato("Lote", actual.orden.codigoLote)
                        FilaDato("Faltan", "${actual.orden.unidadesRestantes} unidades")
                    }

                    if (actual.simulacion) {
                        Spacer(Modifier.height(24.dp))
                        Text(
                            text = "Ensayo de formación",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.height(12.dp))
                        BotonPrincipal(
                            texto = "Simular emblema (todo correcto)",
                            alPulsar = { modelo.simularEmblema() },
                        )
                        Spacer(Modifier.height(10.dp))
                        BotonSecundario(
                            texto = "Simular fallo de grabación",
                            alPulsar = { modelo.simularEmblema(fallarEscritura = true) },
                        )
                        Spacer(Modifier.height(10.dp))
                        BotonSecundario(
                            texto = "Simular comprobación que no coincide",
                            alPulsar = { modelo.simularEmblema(corromperRelectura = true) },
                        )
                    }
                }

                is ProgramacionViewModel.EstadoUi.EnCurso -> {
                    Text(
                        text = actual.mensaje,
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = TextAlign.Center,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.height(20.dp))
                    TarjetaSeccion(titulo = "Avance") {
                        IndicadorPasos(
                            pasos = PASOS_PROGRAMACION,
                            estados = actual.estadosPaso,
                        )
                    }

                    if (actual.advertencia != null) {
                        Spacer(Modifier.height(16.dp))
                        MensajeOperario(
                            texto = actual.advertencia!!,
                            tono = TonoMensaje.AVISO,
                            titulo = "Compruebe el lote",
                        )
                    }

                    val inspeccion = actual.inspeccion
                    if (inspeccion != null) {
                        Spacer(Modifier.height(16.dp))
                        TarjetaSeccion(titulo = "Emblema detectado") {
                            FilaDato("Tipo", inspeccion.chipType.etiquetaOperario, destacado = true)
                            FilaDato("Memoria disponible", "${inspeccion.userMemoryBytes} bytes")
                            FilaDato(
                                "Ya tenía contenido",
                                if (inspeccion.hasNdefMessage) "Sí" else "No",
                            )
                        }
                    }

                    val consulta = actual.consulta
                    if (consulta != null && consulta.conocido) {
                        Spacer(Modifier.height(16.dp))
                        MensajeOperario(
                            texto = "El sistema ya conocía este emblema: " +
                                (consulta.estado?.etiquetaOperario ?: "estado desconocido"),
                            tono = TonoMensaje.INFORMACION,
                        )
                    }
                }

                is ProgramacionViewModel.EstadoUi.Completada -> {
                    IconoResultado(Icons.Filled.CheckCircle, VerdeAprobado)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = if (actual.simulacion) {
                            "Ensayo completado"
                        } else {
                            "Emblema grabado y comprobado"
                        },
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = "Ahora hay que unirlo con el jersey. Tenga el código a la vista.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextoSecundario,
                        textAlign = TextAlign.Center,
                    )

                    Spacer(Modifier.height(20.dp))

                    TarjetaSeccion(titulo = "Resumen") {
                        FilaDato("Orden", actual.orden.codigo)
                        FilaDato("Tipo de emblema", actual.inspeccion.chipType.etiquetaOperario)
                        FilaDato("Comprobación posterior", "Coincide", destacado = true)
                    }

                    // Aviso honesto: aunque todo haya salido bien, una NTAG 21x
                    // NO autentica. Se dice aquí para que nadie salga de esta
                    // pantalla con la idea contraria.
                    if (actual.inspeccion.chipType != TipoChip.NTAG424DNA) {
                        Spacer(Modifier.height(16.dp))
                        MensajeOperario(
                            texto = "Este tipo de emblema permite reconocer el producto, " +
                                "pero no prueba por sí solo que sea original. Es lo previsto " +
                                "para este modelo.",
                            tono = TonoMensaje.INFORMACION,
                            titulo = "Para su información",
                        )
                    }

                    Spacer(Modifier.height(24.dp))
                    BotonPrincipal(texto = "Unir con el jersey", alPulsar = alPasarAVincular)
                }

                is ProgramacionViewModel.EstadoUi.Fallo -> {
                    IconoResultado(
                        Icons.Filled.ErrorOutline,
                        if (actual.reintentable) AmbarAviso else RojoRechazo,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        text = if (actual.reintentable) {
                            "Se puede intentar de nuevo"
                        } else {
                            "Aparte esta unidad"
                        },
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    MensajeOperario(
                        texto = actual.mensajeOperario,
                        tono = if (actual.reintentable) TonoMensaje.AVISO else TonoMensaje.ERROR,
                        titulo = "Qué pasó en: ${actual.paso.titulo}",
                    )

                    Spacer(Modifier.height(16.dp))
                    TarjetaSeccion(titulo = "Hasta dónde llegó") {
                        IndicadorPasos(
                            pasos = PASOS_PROGRAMACION,
                            estados = actual.estadosPaso,
                        )
                    }

                    Spacer(Modifier.height(24.dp))

                    if (actual.reintentable) {
                        BotonPrincipal(
                            texto = "Reintentar con el mismo emblema",
                            alPulsar = modelo::reintentarMismoIntento,
                        )
                        Spacer(Modifier.height(10.dp))
                    }

                    BotonSecundario(
                        texto = "Pasar esta unidad a cuarentena",
                        alPulsar = alAbrirCuarentena,
                    )
                    Spacer(Modifier.height(10.dp))
                    BotonSecundario(
                        texto = "Descartar y empezar otra unidad",
                        alPulsar = modelo::siguienteUnidad,
                    )
                }
            }
        }
    }
}
