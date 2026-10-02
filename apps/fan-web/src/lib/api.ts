import type { TrustLevel } from '@mev/domain/browser';

/**
 * Cliente de la API.
 *
 * Reglas:
 *  - La verificacion se ejecuta en el SERVIDOR de Next (componente de servidor),
 *    de modo que el token del chip no viaja al JavaScript del navegador ni
 *    aparece en el historial de peticiones del cliente.
 *  - Ninguna respuesta se ensancha en el cliente: se consumen exactamente los
 *    campos que la API ya filtro.
 */

/**
 * Direccion interna de la API. Solo la usa el servidor de Next.
 *
 * NO lleva el prefijo `NEXT_PUBLIC_`: ese prefijo incrusta el valor en el
 * paquete que descarga el navegador —filtrando la direccion interna— y ademas
 * lo fija AL CONSTRUIR, de modo que la variable del alojamiento no tendria
 * efecto. Leida asi, se resuelve en cada arranque.
 */
export const API_URL = process.env.API_ORIGIN ?? 'http://localhost:4000';

export interface UnidadPublica {
  club: string;
  clubSlug: string;
  clubColors: { primary: string; secondary: string };
  season: string;
  model: string;
  edition: string;
  playerName: string | null;
  shirtNumber: number | null;
  activatedAt: string | null;
  condition: string;
  claimable: boolean;
  unitHandle: string;
}

export interface ResultadoVerificacion {
  trustLevel: TrustLevel;
  message: { titulo: string; explicacion: string; tono: string };
  maskedRef: string | null;
  unit: UnidadPublica | null;
  actions: string[];
  eventRef: string;
  simulated: boolean;
}

export type MetodoVerificacion = 'NFC_STATIC_URL' | 'QR_CODE' | 'NFC_CRYPTOGRAPHIC';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface PeticionOpciones {
  method?: string;
  body?: unknown;
  token?: string | null;
  /** Cabeceras a reenviar desde la peticion original (idioma, ahorro de datos). */
  forward?: Record<string, string>;
  /** `no-store` en las rutas de verificacion: el resultado nunca se cachea. */
  cache?: RequestCache;
}

export async function peticion<T>(ruta: string, opciones: PeticionOpciones = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opciones.forward,
  };
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;

  const respuesta = await fetch(`${API_URL}${ruta}`, {
    method: opciones.method ?? 'GET',
    headers,
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
    cache: opciones.cache ?? 'no-store',
  });

  const texto = await respuesta.text();
  const datos = texto ? (JSON.parse(texto) as unknown) : null;

  if (!respuesta.ok) {
    const error = (datos as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      respuesta.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'No pudimos completar la operacion. Intente de nuevo.',
    );
  }

  return datos as T;
}

/**
 * Verifica un token presentado.
 *
 * Se invoca SOLO desde componentes de servidor. `method` determina el techo de
 * confianza: un QR nunca puede producir VERIFIED, y eso lo decide el servidor
 * de la API, no este cliente.
 */
export function verificarToken(
  token: string,
  method: MetodoVerificacion,
  forward: Record<string, string> = {},
): Promise<ResultadoVerificacion> {
  return peticion<ResultadoVerificacion>('/api/v1/verify', {
    method: 'POST',
    body: { method, token },
    forward,
  });
}

export interface Certificado {
  serial: string | null;
  issuedAt: string | null;
  revokedAt: string | null;
  maskedRef: string;
  club: string;
  season: string;
  model: string;
  edition: string;
  size: string | null;
  playerName: string | null;
  shirtNumber: number | null;
  activatedAt: string | null;
  condition: string;
  disclaimer: string;
}

export function obtenerCertificado(handle: string): Promise<Certificado> {
  return peticion<Certificado>(`/api/v1/units/${handle}/certificate`);
}

export interface ItemContenido {
  id: string;
  kind: string;
  title: string;
  body: string;
  mediaUrl: string | null;
  mediaAlt: string | null;
  captionsUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  mediaOmittedForLowData: boolean;
}

export interface RespuestaContenido {
  language: string;
  lowDataMode: boolean;
  items: ItemContenido[];
}

export function obtenerContenido(
  handle: string,
  opciones: { trustLevel?: TrustLevel; lowData?: boolean; forward?: Record<string, string> } = {},
): Promise<RespuestaContenido> {
  const params = new URLSearchParams();
  if (opciones.trustLevel) params.set('trustLevel', opciones.trustLevel);
  if (opciones.lowData) params.set('lowData', '1');
  const consulta = params.toString() ? `?${params.toString()}` : '';

  return peticion<RespuestaContenido>(`/api/v1/units/${handle}/content${consulta}`, {
    forward: opciones.forward ?? {},
  });
}
