package ec.marathon.nfcstudio.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Cliente HTTP de la API de produccion.
 *
 * ###########################################################################
 * # REQUISITO DE SEGURIDAD: "Operaciones idempotentes".                     #
 * ###########################################################################
 *
 * TODA operacion que modifica estado lleva la cabecera `Idempotency-Key` como
 * PARAMETRO OBLIGATORIO. No es opcional y no tiene valor por defecto: el
 * compilador obliga a pasarla, asi que es imposible anadir una llamada de
 * escritura sin decidir de donde sale su clave. La clave la genera el ViewModel
 * una sola vez por intento logico (ver `core/Idempotencia.kt`) y la reutiliza
 * intacta en cada reintento.
 *
 * La autorizacion NO viaja aqui: la anade `InterceptorAutorizacion` leyendo el
 * token del almacen cifrado. De este modo ninguna firma de metodo expone el
 * token y no puede colarse por error en un log de parametros.
 *
 * Se devuelve `Response<T>` en lugar de `T` para poder leer el cuerpo de error
 * `{error:{code,message,retryable}}` sin depender de excepciones. Ver
 * `EjecutorApi`.
 */
interface ApiProduccion {

    // --- Autenticacion ------------------------------------------------------

    @POST("api/v1/production/auth/login")
    suspend fun login(@Body cuerpo: SolicitudLogin): Response<RespuestaLogin>

    // --- Ordenes ------------------------------------------------------------

    @GET("api/v1/production/orders")
    suspend fun listarOrdenes(): Response<List<OrdenDto>>

    @GET("api/v1/production/orders/{id}")
    suspend fun obtenerOrden(@Path("id") idOrden: String): Response<OrdenDto>

    // --- Chips --------------------------------------------------------------

    /**
     * Consulta si el chip ya esta registrado. Es de LECTURA: no necesita clave
     * de idempotencia porque repetirla no cambia nada en el servidor.
     */
    @POST("api/v1/production/chips/inspect")
    suspend fun inspeccionarChip(@Body cuerpo: SolicitudInspeccion): Response<RespuestaInspeccion>

    // --- Trabajos de programacion ------------------------------------------

    @POST("api/v1/production/jobs/reserve")
    suspend fun reservarTrabajo(
        @Header(CABECERA_IDEMPOTENCIA) claveIdempotencia: String,
        @Body cuerpo: SolicitudReserva,
    ): Response<RespuestaReserva>

    @POST("api/v1/production/jobs/{jobId}/written")
    suspend fun reportarEscritura(
        @Path("jobId") idTrabajo: String,
        @Header(CABECERA_IDEMPOTENCIA) claveIdempotencia: String,
        @Body cuerpo: SolicitudEscritura,
    ): Response<RespuestaEstadoChip>

    @POST("api/v1/production/jobs/{jobId}/verified")
    suspend fun reportarVerificacion(
        @Path("jobId") idTrabajo: String,
        @Header(CABECERA_IDEMPOTENCIA) claveIdempotencia: String,
        @Body cuerpo: SolicitudVerificacion,
    ): Response<RespuestaEstadoChip>

    // --- Unidades -----------------------------------------------------------

    @POST("api/v1/production/units/link")
    suspend fun vincularUnidad(
        @Header(CABECERA_IDEMPOTENCIA) claveIdempotencia: String,
        @Body cuerpo: SolicitudVinculacion,
    ): Response<RespuestaVinculacion>

    @POST("api/v1/production/units/{unitId}/post-press")
    suspend fun reportarPostTermosellado(
        @Path("unitId") idUnidad: String,
        @Header(CABECERA_IDEMPOTENCIA) claveIdempotencia: String,
        @Body cuerpo: SolicitudPostTermosellado,
    ): Response<RespuestaEstadoChip>

    @POST("api/v1/production/units/{unitId}/activate")
    suspend fun activarUnidad(
        @Path("unitId") idUnidad: String,
        @Header(CABECERA_IDEMPOTENCIA) claveIdempotencia: String,
    ): Response<RespuestaEstadoChip>

    /**
     * Cuarentena.
     *
     * Es la UNICA operacion de escritura sin clave de idempotencia, porque el
     * contrato de la API no la exige para este endpoint: poner en cuarentena dos
     * veces la misma unidad es inocuo y, sobre todo, nunca debe fallar por un
     * conflicto de clave. Si la unidad esta en peligro, entra en cuarentena.
     */
    @POST("api/v1/production/units/{unitId}/quarantine")
    suspend fun ponerEnCuarentena(
        @Path("unitId") idUnidad: String,
        @Body cuerpo: SolicitudCuarentena,
    ): Response<RespuestaEstadoChip>

    companion object {
        const val CABECERA_IDEMPOTENCIA = "Idempotency-Key"
    }
}
