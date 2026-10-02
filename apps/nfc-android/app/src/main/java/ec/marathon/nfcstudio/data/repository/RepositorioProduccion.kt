package ec.marathon.nfcstudio.data.repository

import ec.marathon.nfcstudio.core.ClaveIdempotencia
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.core.mapear
import ec.marathon.nfcstudio.data.api.ApiProduccion
import ec.marathon.nfcstudio.data.api.EjecutorApi
import ec.marathon.nfcstudio.data.api.SolicitudCuarentena
import ec.marathon.nfcstudio.data.api.SolicitudEscritura
import ec.marathon.nfcstudio.data.api.SolicitudInspeccion
import ec.marathon.nfcstudio.data.api.SolicitudPostTermosellado
import ec.marathon.nfcstudio.data.api.SolicitudReserva
import ec.marathon.nfcstudio.data.api.SolicitudVerificacion
import ec.marathon.nfcstudio.data.api.SolicitudVinculacion
import ec.marathon.nfcstudio.domain.model.ConsultaChip
import ec.marathon.nfcstudio.domain.model.EstadoChip
import ec.marathon.nfcstudio.domain.model.MedicionTermosellado
import ec.marathon.nfcstudio.domain.model.MotivoCuarentena
import ec.marathon.nfcstudio.domain.model.PlanBloqueo
import ec.marathon.nfcstudio.domain.model.ReferenciaClave
import ec.marathon.nfcstudio.domain.model.TipoChip
import ec.marathon.nfcstudio.domain.model.TrabajoProgramacion
import ec.marathon.nfcstudio.domain.model.UnidadVinculada

/**
 * Operaciones de produccion contra el servidor.
 *
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Operaciones idempotentes".                     #
 * ###########################################################################
 *
 * Cada metodo de escritura RECIBE la clave de idempotencia; no la genera. Esto
 * es intencional y es la pieza central del diseno: si el repositorio creara la
 * clave, cada reintento generaria una nueva y la idempotencia no serviria de
 * nada. La clave nace en el ViewModel al comenzar el intento logico (una unidad
 * concreta, un paso concreto) y se pasa igual tantas veces como el operario
 * pulse "Reintentar".
 */
class RepositorioProduccion(private val api: ApiProduccion) {

    /**
     * Consulta si el chip ya esta registrado.
     * Operacion de LECTURA: sin clave de idempotencia porque no cambia nada.
     */
    suspend fun inspeccionarChip(uid: String, tipoChip: TipoChip): Resultado<ConsultaChip> =
        EjecutorApi.ejecutar("consulta de chip") {
            api.inspeccionarChip(SolicitudInspeccion(uid = uid, chipType = tipoChip.name))
        }.mapear { respuesta ->
            ConsultaChip(
                conocido = respuesta.known,
                estado = EstadoChip.desdeApi(respuesta.state),
                mensaje = respuesta.message,
            )
        }

    /**
     * Pide al servidor el siguiente identificador y la operacion autorizada.
     *
     * El telefono NO elige la URI ni el identificador: los recibe. Si los
     * eligiera, dos puestos podrian grabar el mismo y la unicidad del
     * identificador publico dependeria de la buena fe del cliente.
     */
    suspend fun reservarTrabajo(
        idOrden: String,
        uid: String,
        tipoChip: TipoChip,
        clave: ClaveIdempotencia,
    ): Resultado<TrabajoProgramacion> =
        EjecutorApi.ejecutar("reserva de trabajo") {
            api.reservarTrabajo(
                claveIdempotencia = clave.valor,
                cuerpo = SolicitudReserva(
                    orderId = idOrden,
                    uid = uid,
                    chipType = tipoChip.name,
                ),
            )
        }.mapear { respuesta ->
            TrabajoProgramacion(
                idTrabajo = respuesta.jobId,
                idChip = respuesta.chipId,
                uriDestino = respuesta.targetUri,
                proveedorId = respuesta.providerId,
                planBloqueo = PlanBloqueo(
                    bloquearNdefSoloLectura = respuesta.lockPlan.lockNdefReadOnly,
                    bloquearConfiguracion = respuesta.lockPlan.lockConfiguration,
                ),
                referenciasClave = respuesta.keyReferences.map {
                    // Solo se copia el puntero al custodio. Aqui no hay secretos.
                    ReferenciaClave(
                        referencia = it.reference,
                        custodio = it.custodian,
                        version = it.version,
                    )
                },
            )
        }

    /**
     * Reporta el resultado de la escritura.
     *
     * Se envia un HASH del payload, no el payload: el contenido grabado incluye
     * el token del chip, y no hay motivo para que vuelva a circular por la red
     * ni aparezca en los registros de acceso del servidor.
     */
    suspend fun reportarEscritura(
        idTrabajo: String,
        exito: Boolean,
        hashPayload: String,
        codigoError: String?,
        clave: ClaveIdempotencia,
    ): Resultado<EstadoChip?> =
        EjecutorApi.ejecutar("reporte de grabación") {
            api.reportarEscritura(
                idTrabajo = idTrabajo,
                claveIdempotencia = clave.valor,
                cuerpo = SolicitudEscritura(
                    success = exito,
                    writtenPayloadHash = hashPayload,
                    errorCode = codigoError,
                ),
            )
        }.mapear { EstadoChip.desdeApi(it.state) }

    suspend fun reportarVerificacion(
        idTrabajo: String,
        coincide: Boolean,
        uriReleida: String?,
        clave: ClaveIdempotencia,
    ): Resultado<EstadoChip?> =
        EjecutorApi.ejecutar("reporte de comprobación") {
            api.reportarVerificacion(
                idTrabajo = idTrabajo,
                claveIdempotencia = clave.valor,
                cuerpo = SolicitudVerificacion(matches = coincide, readBackUri = uriReleida),
            )
        }.mapear { EstadoChip.desdeApi(it.state) }

    suspend fun vincularUnidad(
        idTrabajo: String,
        codigoSku: String,
        codigoEmblema: String,
        codigoBarrasJersey: String,
        clave: ClaveIdempotencia,
    ): Resultado<UnidadVinculada> =
        EjecutorApi.ejecutar("vinculación con el jersey") {
            api.vincularUnidad(
                claveIdempotencia = clave.valor,
                cuerpo = SolicitudVinculacion(
                    jobId = idTrabajo,
                    skuCode = codigoSku,
                    emblemCode = codigoEmblema,
                    jerseyBarcode = codigoBarrasJersey,
                ),
            )
        }.mapear { UnidadVinculada(idUnidad = it.unitId, referenciaPublica = it.publicRef) }

    suspend fun reportarPostTermosellado(
        idUnidad: String,
        aprobado: Boolean,
        legible: Boolean,
        contenidoIntacto: Boolean,
        medicion: MedicionTermosellado,
        simulado: Boolean,
        clave: ClaveIdempotencia,
    ): Resultado<EstadoChip?> =
        EjecutorApi.ejecutar("control tras el termosellado") {
            api.reportarPostTermosellado(
                idUnidad = idUnidad,
                claveIdempotencia = clave.valor,
                cuerpo = SolicitudPostTermosellado(
                    passed = aprobado,
                    readable = legible,
                    contentIntact = contenidoIntacto,
                    temperatureC = medicion.temperaturaC,
                    pressureBar = medicion.presionBar,
                    durationSec = medicion.duracionSeg,
                    // Marca honesta: si la lectura la hizo el simulador se declara,
                    // y el servidor degrada el nivel de confianza en consecuencia.
                    simulated = simulado,
                ),
            )
        }.mapear { EstadoChip.desdeApi(it.state) }

    suspend fun activarUnidad(
        idUnidad: String,
        clave: ClaveIdempotencia,
    ): Resultado<EstadoChip?> =
        EjecutorApi.ejecutar("activación") {
            api.activarUnidad(idUnidad = idUnidad, claveIdempotencia = clave.valor)
        }.mapear { EstadoChip.desdeApi(it.state) }

    /**
     * Cuarentena. Sin clave de idempotencia por diseno del contrato: esta
     * operacion nunca debe fallar por un conflicto de clave. Si algo va mal con
     * una unidad, entra en cuarentena, y punto.
     */
    suspend fun ponerEnCuarentena(
        idUnidad: String,
        motivo: MotivoCuarentena,
        detalleLibre: String? = null,
    ): Resultado<EstadoChip?> =
        EjecutorApi.ejecutar("cuarentena") {
            api.ponerEnCuarentena(
                idUnidad = idUnidad,
                cuerpo = SolicitudCuarentena(
                    reason = if (detalleLibre.isNullOrBlank()) {
                        motivo.name
                    } else {
                        "${motivo.name}: ${detalleLibre.take(200)}"
                    },
                ),
            )
        }.mapear { EstadoChip.desdeApi(it.state) }
}
