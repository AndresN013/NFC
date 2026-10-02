/**
 * Puente del navegador del panel hacia la API.
 *
 * Reemplaza al `rewrite` de `next.config.mjs`, que resolvia la direccion de la
 * API AL CONSTRUIR y por tanto dejaba congelado `http://localhost:4000` en la
 * imagen. Un manejador de ruta lee el entorno en cada peticion.
 *
 * Mantiene las dos razones por las que el panel nunca llama a la API directo:
 *
 *  1. `x-export-truncated` se lee siempre. En una peticion de origen cruzado el
 *     navegador oculta las cabeceras que no esten en `Access-Control-Expose-
 *     Headers`, y una exportacion recortada pasaria por completa.
 *  2. No depende de la lista blanca de CORS de la API.
 *
 * El token viaja en `Authorization` y se reenvia tal cual.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CABECERAS_HACIA_API = ['authorization', 'content-type', 'accept'];

/**
 * `x-export-truncated` y `content-disposition` son imprescindibles: sin la
 * primera, una exportacion incompleta se presentaria como completa.
 */
const CABECERAS_HACIA_NAVEGADOR = [
  'content-type',
  'content-disposition',
  'cache-control',
  'x-export-truncated',
];

function origenApi(): string {
  return process.env.API_ORIGIN ?? 'http://localhost:4000';
}

async function reenviar(peticion: Request, ruta: string[]): Promise<Response> {
  const entrada = new URL(peticion.url);
  const destino = new URL(`${origenApi()}/api/v1/${ruta.join('/')}`);
  destino.search = entrada.search;

  const cabeceras = new Headers();
  for (const nombre of CABECERAS_HACIA_API) {
    const valor = peticion.headers.get(nombre);
    if (valor) cabeceras.set(nombre, valor);
  }

  const reenviadaPor = peticion.headers.get('x-forwarded-for');
  if (reenviadaPor) cabeceras.set('x-forwarded-for', reenviadaPor);

  const metodo = peticion.method;
  const cuerpo = metodo === 'GET' || metodo === 'HEAD' ? undefined : await peticion.text();

  let respuesta: Response;
  try {
    respuesta = await fetch(destino, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_INALCANZABLE', message: 'No se pudo contactar con el servicio.' } },
      { status: 502 },
    );
  }

  const salida = new Headers();
  for (const nombre of CABECERAS_HACIA_NAVEGADOR) {
    const valor = respuesta.headers.get(nombre);
    if (valor) salida.set(nombre, valor);
  }

  return new NextResponse(respuesta.body, { status: respuesta.status, headers: salida });
}

type Contexto = { params: Promise<{ ruta: string[] }> };

async function manejar(peticion: Request, contexto: Contexto): Promise<Response> {
  const { ruta } = await contexto.params;
  return reenviar(peticion, ruta);
}

export const GET = manejar;
export const POST = manejar;
export const PATCH = manejar;
export const PUT = manejar;
export const DELETE = manejar;
