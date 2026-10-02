/**
 * Puente del navegador hacia la API.
 *
 * El navegador llama a `/api/upstream/...` y este manejador reenvia a
 * `<API_ORIGIN>/api/v1/...`. Asi la API no necesita estar expuesta a internet
 * ni mantener una lista blanca de CORS: para el navegador todo es el mismo
 * origen.
 *
 * Antes esto era un `rewrite` de `next.config.mjs`. No sirve en un alojamiento
 * real: Next serializa los rewrites en el manifiesto AL CONSTRUIR, de modo que
 * la direccion de la API quedaba congelada con el valor que hubiera durante el
 * build (`http://localhost:4000`) y la variable del proveedor no tenia efecto.
 * Un manejador de ruta lee el entorno en CADA peticion, que es lo que hace
 * falta cuando la imagen se construye una vez y se despliega en varios sitios.
 */

import { NextResponse } from 'next/server';

// Nunca precalcular: la respuesta depende del token de quien llama.
export const dynamic = 'force-dynamic';

/** Cabeceras que se reenvian hacia la API. El resto se descarta a proposito. */
const CABECERAS_HACIA_API = ['authorization', 'content-type', 'accept'];

/** Cabeceras que se devuelven al navegador. */
const CABECERAS_HACIA_NAVEGADOR = ['content-type', 'cache-control'];

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

  // La IP del aficionado la necesita la API para su limitador de peticiones.
  // Sin esto, todas las llamadas parecerian venir de este servidor y un solo
  // visitante agotaria el limite de todos.
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
    // La API caida no debe devolver una pagina de error de Next: el cliente
    // espera JSON y lo trata como un fallo de la API.
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
