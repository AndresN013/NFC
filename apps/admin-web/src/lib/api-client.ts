/**
 * Cliente HTTP del panel.
 *
 * Responsabilidades:
 *  - anadir `Authorization: Bearer <token>` cuando hay sesion;
 *  - convertir los errores de la API en `ApiError` con codigo y mensaje utiles;
 *  - tratar el 401 como "la sesion ya no vale": se limpia y se vuelve a /entrar;
 *  - detectar una exportacion CSV truncada leyendo `x-export-truncated`.
 */

/** Prefijo de la reescritura de Next hacia la API. Ver `next.config.mjs`. */
export const DEFAULT_API_BASE = '/api/upstream';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Codigo de la API (`FORBIDDEN`, `NOT_FOUND`...) o `NETWORK` si no hubo respuesta. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** El usuario tiene sesion valida pero le falta el permiso. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface CsvResult {
  filename: string;
  text: string;
  /**
   * `true` cuando la API avisa de que el fichero llego al techo de filas.
   * Una exportacion incompleta que no se anuncia se lee como si fuera todo.
   */
  truncated: boolean;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Devuelve el token vigente, o null si no hay sesion. */
  getToken?: () => string | null;
  /** Se invoca en cada 401 para limpiar la sesion y redirigir. */
  onUnauthorized?: () => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  /** Descarga una exportacion CSV e informa si quedo truncada. */
  getCsv(path: string, query?: Query): Promise<CsvResult>;
}

/** Serializa la consulta omitiendo vacios, para no enviar `?state=` sin valor. */
export function buildQueryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Lee `x-export-truncated`. Solo `"true"` cuenta como truncado. */
export function isTruncatedExport(headers: Headers): boolean {
  return headers.get('x-export-truncated')?.trim().toLowerCase() === 'true';
}

/** Extrae el nombre de fichero de `content-disposition`, con respaldo. */
export function filenameFromDisposition(headers: Headers, fallback: string): string {
  const disposition = headers.get('content-disposition');
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function readError(response: Response): Promise<ApiError> {
  let code = `HTTP_${response.status}`;
  let message = `La API respondio ${response.status}.`;
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Respuesta sin JSON (por ejemplo un 502 del proxy): se mantiene el texto generico.
  }
  return new ApiError(response.status, code, message);
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function send(path: string, options_: RequestOptions): Promise<Response> {
    const token = options.getToken?.() ?? null;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (options_.body !== undefined) headers['content-type'] = 'application/json';

    const init: RequestInit = {
      method: options_.method ?? 'GET',
      headers,
      // El token va en la cabecera: no hacen falta cookies de tercero.
      credentials: 'omit',
    };
    if (options_.body !== undefined) init.body = JSON.stringify(options_.body);
    if (options_.signal) init.signal = options_.signal;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}${buildQueryString(options_.query)}`, init);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError(0, 'NETWORK', 'No se pudo contactar con el servidor.');
    }

    if (response.status === 401) {
      // La sesion caduco o fue revocada. No se reintenta: se cierra sesion.
      options.onUnauthorized?.();
      throw new ApiError(401, 'UNAUTHORIZED', 'Su sesion ha caducado. Vuelva a entrar.');
    }
    if (!response.ok) throw await readError(response);
    return response;
  }

  // Las funciones se declaran aparte (en vez de como metodos que se llamen con
  // `this`) para que el cliente siga funcionando si alguien desestructura
  // `const { get } = api`.
  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const response = await send(path, requestOptions);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function getCsv(path: string, query?: Query): Promise<CsvResult> {
    const response = await send(path, { method: 'GET', ...(query ? { query } : {}) });
    return {
      filename: filenameFromDisposition(response.headers, 'exportacion.csv'),
      text: await response.text(),
      truncated: isTruncatedExport(response.headers),
    };
  }

  return {
    request,
    get: <T,>(path: string, query?: Query) =>
      request<T>(path, { method: 'GET', ...(query ? { query } : {}) }),
    post: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: 'POST', body: body ?? {} }),
    patch: <T,>(path: string, body?: unknown) =>
      request<T>(path, { method: 'PATCH', body: body ?? {} }),
    getCsv,
  };
}
