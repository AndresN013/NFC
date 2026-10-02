package ec.marathon.nfcstudio.domain.usecase

import ec.marathon.nfcstudio.core.ClavesDeUnidad
import ec.marathon.nfcstudio.core.CodigoError
import ec.marathon.nfcstudio.core.ErrorApp
import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.data.repository.OperacionPendiente
import ec.marathon.nfcstudio.data.repository.RepositorioHistorial
import ec.marathon.nfcstudio.data.repository.RepositorioProduccion
import ec.marathon.nfcstudio.data.repository.RepositorioReintentos
import ec.marathon.nfcstudio.domain.model.EstadoChip
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import ec.marathon.nfcstudio.domain.model.PasoProceso
import ec.marathon.nfcstudio.domain.model.TipoChip
import ec.marathon.nfcstudio.domain.model.TrabajoProgramacion
import ec.marathon.nfcstudio.domain.model.puedeTransicionarChip
import ec.marathon.nfcstudio.nfc.CodigoErrorNfc
import ec.marathon.nfcstudio.nfc.NfcOperationException
import ec.marathon.nfcstudio.nfc.NfcPersonalizationProvider
import ec.marathon.nfcstudio.nfc.PersonalizationPlan
import ec.marathon.nfcstudio.nfc.TagDetection
import ec.marathon.nfcstudio.nfc.TagInspection
import ec.marathon.nfcstudio.nfc.VerifyPersonalizationResult
import ec.marathon.nfcstudio.nfc.WriteResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Orquestacion del FLUJO DE PROGRAMACION de una unidad.
 *
 * El orden de los pasos NO es negociable y esta escrito aqui una sola vez, para
 * que ninguna pantalla pueda saltarse uno:
 *
 *   1. detectar el chip
 *   2. identificar el tipo (familia)
 *   3. leer la informacion tecnica
 *   4. preguntar al SERVIDOR si ese chip ya esta registrado
 *   5. pedir al SERVIDOR el siguiente identificador y la operacion autorizada
 *   6. comprobar localmente que el plan es ejecutable
 *   7. escribir NDEF (o ejecutar el proveedor seguro cuando exista)
 *   8. avisar al servidor del resultado de la escritura
 *   9. RELEER el chip y comparar
 *  10. avisar al servidor del resultado de la comprobacion
 *
 * El paso 9 es el que convierte "la escritura no dio error" en "el chip contiene
 * lo que debe contener". Sin el, un corte de radio a mitad de escritura pasaria
 * por bueno y el jersey saldria a la calle con un emblema ilegible.
 *
 * Se expone como [Flow] de [AvanceProgramacion] para que la pantalla muestre
 * cada paso a medida que ocurre: el operario necesita saber en que punto esta y,
 * si falla, en cual fallo.
 */
class ProgramarChip(
    private val repositorioProduccion: RepositorioProduccion,
    private val repositorioHistorial: RepositorioHistorial,
    private val repositorioReintentos: RepositorioReintentos,
) {

    fun ejecutar(
        proveedor: NfcPersonalizationProvider,
        orden: OrdenProduccion,
        claves: ClavesDeUnidad,
    ): Flow<AvanceProgramacion> = flow {
        val simulado = proveedor.capabilities.isSimulation

        // --- Paso 1 y 2: deteccion e identificacion del tipo ----------------
        emit(AvanceProgramacion.EnCurso(PasoProceso.DETECCION, "Leyendo el emblema…"))
        val deteccion: TagDetection = try {
            proveedor.detectTag()
        } catch (error: NfcOperationException) {
            emit(AvanceProgramacion.FalloNfc(PasoProceso.DETECCION, error))
            return@flow
        }

        if (deteccion.chipType == TipoChip.UNKNOWN) {
            emit(
                AvanceProgramacion.FalloOperacion(
                    PasoProceso.DETECCION,
                    "No reconocemos este tipo de emblema. Aparte la unidad y avise al supervisor.",
                    reintentable = false,
                ),
            )
            return@flow
        }

        // Aviso, no bloqueo: la autoridad sobre el lote es del servidor, que
        // rechaza la reserva si el tipo no corresponde. Aqui solo se advierte
        // para que el operario no gaste tiempo.
        if (orden.tipoChipEsperado != TipoChip.UNKNOWN &&
            orden.tipoChipEsperado != deteccion.chipType
        ) {
            emit(
                AvanceProgramacion.Advertencia(
                    "Este emblema parece de otro tipo (${deteccion.chipType.etiquetaOperario}) " +
                        "del que indica la orden (${orden.tipoChipEsperado.etiquetaOperario}). " +
                        "Verifique el lote antes de continuar.",
                ),
            )
        }

        // --- Paso 3: informacion tecnica ------------------------------------
        emit(AvanceProgramacion.EnCurso(PasoProceso.INSPECCION, "Revisando el chip…"))
        val inspeccion: TagInspection = try {
            proveedor.inspectTag(deteccion)
        } catch (error: NfcOperationException) {
            emit(AvanceProgramacion.FalloNfc(PasoProceso.INSPECCION, error))
            return@flow
        }
        emit(AvanceProgramacion.ChipInspeccionado(inspeccion))

        if (inspeccion.readOnly) {
            registrar(orden, deteccion.uid, PasoProceso.INSPECCION, false, "Chip bloqueado", simulado)
            emit(
                AvanceProgramacion.FalloOperacion(
                    PasoProceso.INSPECCION,
                    ec.marathon.nfcstudio.nfc.MENSAJES_OPERARIO_NFC
                        .getValue(CodigoErrorNfc.TAG_READ_ONLY),
                    reintentable = false,
                ),
            )
            return@flow
        }

        // --- Paso 4: consulta al servidor -----------------------------------
        emit(AvanceProgramacion.EnCurso(PasoProceso.CONSULTA_SERVIDOR, "Consultando el sistema…"))
        val consulta = repositorioProduccion.inspeccionarChip(deteccion.uid, deteccion.chipType)
        if (consulta is Resultado.Fallo) {
            emit(AvanceProgramacion.FalloServidor(PasoProceso.CONSULTA_SERVIDOR, consulta.error))
            return@flow
        }
        val datosConsulta = (consulta as Resultado.Exito).valor
        emit(AvanceProgramacion.ConsultaResuelta(datosConsulta))

        /*
         * Un chip ya conocido solo puede continuar si su estado admite la
         * transicion a PERSONALIZING. La comprobacion se hace con la MISMA
         * maquina de estados que usa el servidor (packages/domain/src/states.ts),
         * asi el operario recibe un mensaje claro en vez de un 409 opaco.
         */
        if (datosConsulta.conocido) {
            val estadoActual = datosConsulta.estado
            val puedeSeguir = estadoActual != null &&
                (
                    puedeTransicionarChip(estadoActual, EstadoChip.PERSONALIZING) ||
                        estadoActual == EstadoChip.RESERVED
                    )
            if (!puedeSeguir) {
                registrar(
                    orden, deteccion.uid, PasoProceso.CONSULTA_SERVIDOR, false,
                    "Chip ya registrado en estado ${estadoActual?.name ?: "desconocido"}", simulado,
                )
                emit(
                    AvanceProgramacion.FalloOperacion(
                        PasoProceso.CONSULTA_SERVIDOR,
                        "Este emblema ya está registrado como " +
                            "«${estadoActual?.etiquetaOperario ?: "desconocido"}». " +
                            "Aparte la unidad y avise al supervisor.",
                        reintentable = false,
                    ),
                )
                return@flow
            }
        }

        // --- Paso 5: reserva -----------------------------------------------
        emit(AvanceProgramacion.EnCurso(PasoProceso.RESERVA, "Pidiendo el identificador…"))
        val reserva = repositorioProduccion.reservarTrabajo(
            idOrden = orden.id,
            uid = deteccion.uid,
            tipoChip = deteccion.chipType,
            // MISMA clave en todos los reintentos de esta unidad.
            clave = claves.reserva,
        )
        if (reserva is Resultado.Fallo) {
            emit(AvanceProgramacion.FalloServidor(PasoProceso.RESERVA, reserva.error))
            return@flow
        }
        val trabajo: TrabajoProgramacion = (reserva as Resultado.Exito).valor
        emit(AvanceProgramacion.TrabajoReservado(trabajo))

        // El servidor manda qué proveedor debe ejecutar la operacion. Si no
        // coincide con el que este telefono tiene montado, se detiene: ejecutar
        // otro seria producir una unidad distinta de la que el sistema espera.
        if (trabajo.proveedorId != proveedor.capabilities.id) {
            emit(
                AvanceProgramacion.FalloOperacion(
                    PasoProceso.RESERVA,
                    "El sistema pide un equipo distinto para esta orden. " +
                        "Avise al supervisor: este teléfono no puede completarla.",
                    reintentable = false,
                ),
            )
            return@flow
        }

        val plan = PersonalizationPlan(
            jobId = trabajo.idTrabajo,
            uri = trabajo.uriDestino,
            // Referencias OPACAS, nunca claves. Ver ReferenciaClave.
            keyReferences = trabajo.referenciasClave,
            lockPlan = trabajo.planBloqueo,
        )

        // --- Paso 6: comprobacion local previa ------------------------------
        val preparacion = proveedor.preparePersonalization(inspeccion, plan)
        if (!preparacion.ok) {
            val info = preparacion.error
            registrar(
                orden, deteccion.uid, PasoProceso.ESCRITURA, false,
                info?.detail ?: "Preparación rechazada", simulado,
            )
            emit(
                AvanceProgramacion.FalloOperacion(
                    PasoProceso.ESCRITURA,
                    info?.operatorMessage ?: "No se puede grabar este emblema.",
                    reintentable = info?.retryable ?: false,
                ),
            )
            return@flow
        }

        // --- Paso 7: escritura ----------------------------------------------
        emit(AvanceProgramacion.EnCurso(PasoProceso.ESCRITURA, "Grabando. No mueva el emblema."))
        val escritura: WriteResult = if (proveedor.capabilities.canProduceCryptographicProof) {
            // Camino previsto para chips seguros. Hoy ningun proveedor declara
            // esta capacidad, asi que en la practica no se toma.
            proveedor.personalizeSecureTag(inspeccion, plan)
        } else {
            proveedor.writeNdef(inspeccion, plan)
        }

        val hashPayload = if (escritura.writtenPayloadHex.isNotEmpty()) {
            HashPayload.deHex(escritura.writtenPayloadHex)
        } else {
            ""
        }

        // --- Paso 8: aviso de escritura al servidor -------------------------
        val avisoEscritura = repositorioProduccion.reportarEscritura(
            idTrabajo = trabajo.idTrabajo,
            exito = escritura.success,
            hashPayload = hashPayload,
            codigoError = escritura.error?.code?.name,
            clave = claves.escritura,
        )
        if (avisoEscritura is Resultado.Fallo) {
            // El chip PUEDE estar ya grabado. Se encola el aviso con su clave
            // original para que el reintento sea el mismo intento, no otro.
            if (escritura.success) {
                repositorioReintentos.encolar(
                    OperacionPendiente(
                        claveIdempotencia = claves.escritura,
                        paso = PasoProceso.ESCRITURA,
                        codigoOrden = orden.codigo,
                        idTrabajo = trabajo.idTrabajo,
                        hashPayload = hashPayload,
                        simulado = simulado,
                    ),
                )
            }
            emit(AvanceProgramacion.FalloServidor(PasoProceso.ESCRITURA, avisoEscritura.error))
            return@flow
        }

        if (!escritura.success) {
            registrar(
                orden, deteccion.uid, PasoProceso.ESCRITURA, false,
                escritura.error?.detail ?: "Escritura fallida", simulado,
            )
            emit(
                AvanceProgramacion.FalloOperacion(
                    PasoProceso.ESCRITURA,
                    escritura.error?.operatorMessage
                        ?: "No se pudo grabar. Retire el teléfono, vuelva a acercarlo e intente de nuevo.",
                    reintentable = escritura.error?.retryable ?: true,
                ),
            )
            return@flow
        }

        registrar(orden, deteccion.uid, PasoProceso.ESCRITURA, true, "Grabado", simulado)

        // --- Paso 9: RELECTURA ----------------------------------------------
        emit(AvanceProgramacion.EnCurso(PasoProceso.RELECTURA, "Comprobando la grabación…"))
        val verificacion: VerifyPersonalizationResult =
            proveedor.verifyPersonalization(inspeccion, plan, escritura)

        // --- Paso 10: aviso de verificacion ---------------------------------
        val avisoVerificacion = repositorioProduccion.reportarVerificacion(
            idTrabajo = trabajo.idTrabajo,
            coincide = verificacion.matches,
            uriReleida = verificacion.readBackUri,
            clave = claves.verificacion,
        )
        if (avisoVerificacion is Resultado.Fallo) {
            repositorioReintentos.encolar(
                OperacionPendiente(
                    claveIdempotencia = claves.verificacion,
                    paso = PasoProceso.RELECTURA,
                    codigoOrden = orden.codigo,
                    idTrabajo = trabajo.idTrabajo,
                    uriReleida = verificacion.readBackUri,
                    coincide = verificacion.matches,
                    simulado = simulado,
                ),
            )
            emit(AvanceProgramacion.FalloServidor(PasoProceso.RELECTURA, avisoVerificacion.error))
            return@flow
        }

        registrar(
            orden, deteccion.uid, PasoProceso.RELECTURA, verificacion.matches,
            verificacion.detail, simulado,
        )

        if (!verificacion.matches) {
            // La unidad NO continua. El servidor ya la movio a cuarentena al
            // recibir matches=false; la app no necesita pedirlo otra vez.
            emit(
                AvanceProgramacion.FalloOperacion(
                    PasoProceso.RELECTURA,
                    ec.marathon.nfcstudio.nfc.MENSAJES_OPERARIO_NFC
                        .getValue(CodigoErrorNfc.VERIFY_MISMATCH),
                    reintentable = false,
                ),
            )
            return@flow
        }

        emit(
            AvanceProgramacion.Completado(
                trabajo = trabajo,
                inspeccion = inspeccion,
                verificacion = verificacion,
                simulado = simulado,
            ),
        )
    }

    private suspend fun registrar(
        orden: OrdenProduccion,
        uid: String,
        paso: PasoProceso,
        exito: Boolean,
        detalle: String,
        simulado: Boolean,
    ) {
        // REQUISITO: "registrar operario/teléfono/fecha/resultado".
        // El operario y el telefono los anade el SERVIDOR a partir del token y de
        // la cabecera X-Device-Id, que es donde no pueden falsificarse. Aqui solo
        // se guarda la copia local del turno, sin el UID completo.
        repositorioHistorial.registrar(
            codigoOrden = orden.codigo,
            uid = uid,
            paso = paso,
            exito = exito,
            detalle = detalle,
            simulado = simulado,
        )
    }
}

/** Avance del flujo, emitido paso a paso para que la pantalla lo refleje. */
sealed interface AvanceProgramacion {

    data class EnCurso(val paso: PasoProceso, val mensaje: String) : AvanceProgramacion

    data class Advertencia(val mensaje: String) : AvanceProgramacion

    data class ChipInspeccionado(val inspeccion: TagInspection) : AvanceProgramacion

    data class ConsultaResuelta(
        val consulta: ec.marathon.nfcstudio.domain.model.ConsultaChip,
    ) : AvanceProgramacion

    data class TrabajoReservado(val trabajo: TrabajoProgramacion) : AvanceProgramacion

    data class Completado(
        val trabajo: TrabajoProgramacion,
        val inspeccion: TagInspection,
        val verificacion: VerifyPersonalizationResult,
        val simulado: Boolean,
    ) : AvanceProgramacion

    data class FalloNfc(
        val paso: PasoProceso,
        val excepcion: NfcOperationException,
    ) : AvanceProgramacion {
        val mensajeOperario: String get() = excepcion.info.operatorMessage
        val reintentable: Boolean get() = excepcion.info.retryable
    }

    data class FalloServidor(val paso: PasoProceso, val error: ErrorApp) : AvanceProgramacion {
        val mensajeOperario: String get() = error.mensajeOperario
        val reintentable: Boolean get() = error.reintentable
    }

    data class FalloOperacion(
        val paso: PasoProceso,
        val mensajeOperario: String,
        val reintentable: Boolean,
    ) : AvanceProgramacion

    companion object {
        /** Error generico cuando algo se rompe fuera de los caminos previstos. */
        fun inesperado(paso: PasoProceso, causa: Throwable): FalloServidor = FalloServidor(
            paso,
            ErrorApp.de(
                CodigoError.INTERNO,
                "Fallo inesperado en $paso: ${causa.javaClass.simpleName}",
            ),
        )
    }
}
