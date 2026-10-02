package ec.marathon.nfcstudio.data.repository

import ec.marathon.nfcstudio.core.Resultado
import ec.marathon.nfcstudio.core.mapear
import ec.marathon.nfcstudio.data.api.ApiProduccion
import ec.marathon.nfcstudio.data.api.EjecutorApi
import ec.marathon.nfcstudio.data.api.OrdenDto
import ec.marathon.nfcstudio.domain.model.OrdenProduccion
import ec.marathon.nfcstudio.domain.model.TipoChip

/** Ordenes de produccion disponibles para el puesto de trabajo. */
class RepositorioOrdenes(private val api: ApiProduccion) {

    suspend fun listar(): Resultado<List<OrdenProduccion>> =
        EjecutorApi.ejecutar("listar órdenes") { api.listarOrdenes() }
            .mapear { lista -> lista.map { it.aDominio() } }

    suspend fun obtener(idOrden: String): Resultado<OrdenProduccion> =
        EjecutorApi.ejecutar("detalle de orden") { api.obtenerOrden(idOrden) }
            .mapear { it.aDominio() }

}

private fun OrdenDto.aDominio(): OrdenProduccion = OrdenProduccion(
    id = id,
    codigo = code,
    estado = state,
    unidadesPlanificadas = plannedUnits,
    unidadesRestantes = remainingUnits,
    nombreClub = clubName,
    nombreTemporada = seasonName,
    nombreModelo = modelName,
    codigoLote = batchCode,
    codigoSku = skuCode ?: "",
    // El lote declara que tipo de chip lleva. Sirve para avisar al operario
    // ANTES de tocar el emblema si lo que detecta no corresponde a la orden.
    tipoChipEsperado = TipoChip.desdeApi(expectedChipType),
)
