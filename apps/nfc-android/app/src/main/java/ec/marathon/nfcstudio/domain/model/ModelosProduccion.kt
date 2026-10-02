package ec.marathon.nfcstudio.domain.model

/**
 * Modelos de dominio que maneja la interfaz.
 *
 * Deliberadamente separados de los DTO de `data/api`: los DTO cambian cuando
 * cambia el contrato HTTP, estos cambian cuando cambia lo que ve el operario.
 * Mezclarlos hace que un renombrado del backend rompa una pantalla.
 */

/** Orden de produccion tal y como la necesita el puesto de trabajo. */
data class OrdenProduccion(
    val id: String,
    val codigo: String,
    val estado: String,
    val unidadesPlanificadas: Int,
    val unidadesRestantes: Int,
    val nombreClub: String,
    val nombreTemporada: String,
    val nombreModelo: String,
    val codigoLote: String,
    /** SKU que se enviara al vincular la unidad. Puede venir vacio. */
    val codigoSku: String = "",
    /** Tipo de chip que declara el lote. UNKNOWN si el servidor no lo informa. */
    val tipoChipEsperado: TipoChip = TipoChip.UNKNOWN,
) {
    val unidadesHechas: Int get() = (unidadesPlanificadas - unidadesRestantes).coerceAtLeast(0)

    val progreso: Float
        get() = if (unidadesPlanificadas <= 0) 0f
        else unidadesHechas.toFloat() / unidadesPlanificadas.toFloat()

    /** Una orden sin unidades restantes no debe permitir apoyar un emblema. */
    val admiteTrabajo: Boolean get() = unidadesRestantes > 0 && estado != "COMPLETED" && estado != "CANCELLED"
}

/** Lo que el servidor sabe de un chip antes de tocarlo. */
data class ConsultaChip(
    val conocido: Boolean,
    val estado: EstadoChip?,
    val mensaje: String,
)

/**
 * Trabajo autorizado por el servidor.
 *
 * SEGURIDAD: observese que aqui NO hay ninguna clave. Solo `proveedorId` (que
 * proveedor debe ejecutar la operacion) y, cuando el chip lo requiera, una
 * referencia opaca. El telefono no puede derivar material criptografico ni
 * aunque su almacenamiento fuera volcado.
 */
data class TrabajoProgramacion(
    val idTrabajo: String,
    val idChip: String,
    val uriDestino: String,
    val proveedorId: String,
    val planBloqueo: PlanBloqueo,
    val referenciasClave: List<ReferenciaClave> = emptyList(),
)

/**
 * Referencia OPACA a una clave. NO contiene la clave.
 * Portado de `KeyReference` en `packages/nfc-contracts/src/provider.ts`.
 *
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "NINGUNA clave maestra en la app. Nunca."       #
 * ###########################################################################
 *
 * Este tipo es el UNICO vehiculo por el que el material criptografico puede
 * mencionarse en el telefono, y lo que transporta es un puntero al custodio
 * (KMS/HSM/SAM), no el secreto. La operacion criptografica la ejecuta el
 * servicio que custodia la clave. Si alguna vez aparece en este proyecto un
 * campo `ByteArray` llamado "clave", es un fallo de revision.
 */
data class ReferenciaClave(
    /** Identificador en el custodio, p.ej. un ARN de KMS o un slot de SAM. */
    val referencia: String,
    /** Custodio: kms, hsm, sam o none (solo para el proveedor simulado). */
    val custodio: String,
    /** Version de la clave, para rotacion. */
    val version: Int,
)

/** Areas que deben bloquearse tras verificar la escritura. */
data class PlanBloqueo(
    /** Bloquear el area NDEF como solo lectura de forma IRREVERSIBLE. */
    val bloquearNdefSoloLectura: Boolean,
    /** Bloquear los bits de configuracion. IRREVERSIBLE. Exige confirmacion. */
    val bloquearConfiguracion: Boolean,
) {
    val exigeAlgo: Boolean get() = bloquearNdefSoloLectura || bloquearConfiguracion
}

/** Unidad de jersey ya vinculada. */
data class UnidadVinculada(
    val idUnidad: String,
    val referenciaPublica: String,
)

/** Resultado de la prueba posterior al termosellado. */
data class MedicionTermosellado(
    val temperaturaC: Double?,
    val presionBar: Double?,
    val duracionSeg: Int?,
)

/**
 * Entrada del historial local del operario.
 *
 * Se guarda en el telefono para que el operario pueda revisar su turno aunque
 * se caiga la red. NO sustituye a la auditoria del servidor: es una copia de
 * conveniencia, y por eso guarda una huella corta del UID y no el UID entero.
 */
data class EventoHistorial(
    val idEvento: String,
    val marcaTiempoMs: Long,
    val codigoOrden: String,
    val huellaChip: String,
    val paso: PasoProceso,
    val exito: Boolean,
    val detalle: String,
    val simulado: Boolean,
)

/** Pasos del flujo, en el orden exacto en el que ocurren en planta. */
enum class PasoProceso(val titulo: String) {
    DETECCION("Detección del emblema"),
    INSPECCION("Lectura técnica"),
    CONSULTA_SERVIDOR("Consulta al sistema"),
    RESERVA("Asignación del identificador"),
    ESCRITURA("Grabación"),
    RELECTURA("Comprobación de la grabación"),
    BLOQUEO("Bloqueo del chip"),
    VINCULACION("Unión con el jersey"),
    LISTO_PRENSA("Marcado listo para prensa"),
    POST_TERMOSELLADO("Prueba tras la prensa"),
    ACTIVACION("Activación"),
    CUARENTENA("Envío a cuarentena"),
}

/** Motivos de cuarentena ofrecidos al operario. Lista cerrada a proposito:
 *  un campo libre produce datos que nadie puede analizar despues. */
enum class MotivoCuarentena(val etiqueta: String) {
    RELECTURA_NO_COINCIDE("La comprobación no coincidió con lo grabado"),
    CHIP_NO_RESPONDE("El emblema dejó de responder"),
    CHIP_BLOQUEADO("El chip ya estaba bloqueado"),
    CHIP_YA_REGISTRADO("El chip ya estaba registrado en el sistema"),
    DANO_FISICO("Daño físico visible en el emblema o el jersey"),
    FALLO_TRAS_PRENSA("Falló la prueba después del termosellado"),
    CODIGO_JERSEY_ERRONEO("El código del jersey no corresponde"),
    OTRO("Otro motivo (lo revisa el supervisor)"),
}
