'use client';

import { useCallback, useEffect, useState } from 'react';
import { borrarSesion, leerSesion, type SesionAficionado } from './sesion';

/**
 * Base de las llamadas hechas DESDE EL NAVEGADOR.
 *
 * Es una ruta relativa a proposito: las peticiones van al propio servidor de
 * Next, que las reenvia a la API. De ese modo la web funciona igual abierta en
 * `localhost` que desde el telefono de un aficionado en la red, sin depender de
 * que ese origen este en la lista blanca de CORS de la API.
 *
 * Las llamadas del SERVIDOR usan la URL absoluta y viven en `api.ts`.
 */
const BASE_NAVEGADOR = '/api/upstream';

/**
 * Utilidades de cliente para las paginas que requieren sesion.
 *
 * Una sesion caducada NUNCA debe romper la pagina: se limpia y se pide entrar
 * de nuevo. Verificar un jersey no pasa por aqui, asi que un fallo de sesion no
 * afecta a la funcion central del producto.
 */

export interface ErrorApi {
  status: number;
  code: string;
  message: string;
}

export async function llamar<T>(
  ruta: string,
  opciones: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;

  // `ruta` llega como `/api/v1/...`; se reescribe al proxy del propio servidor.
  const destino = `${BASE_NAVEGADOR}${ruta.replace(/^\/api\/v1/, '')}`;

  const respuesta = await fetch(destino, {
    method: opciones.method ?? 'GET',
    headers,
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  });

  const texto = await respuesta.text();
  const datos = texto ? (JSON.parse(texto) as unknown) : null;

  if (!respuesta.ok) {
    // Un 401 significa que la sesion ya no vale: se borra de inmediato para que
    // la interfaz no siga intentandolo con un token muerto.
    if (respuesta.status === 401) borrarSesion();

    const error = (datos as { error?: { code?: string; message?: string } } | null)?.error;
    throw {
      status: respuesta.status,
      code: error?.code ?? 'UNKNOWN',
      message: error?.message ?? 'No pudimos completar la operacion. Intente de nuevo.',
    } satisfies ErrorApi;
  }

  return datos as T;
}

export function mensajeDeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Ocurrio un error inesperado. Intente de nuevo.';
}

/**
 * Lee la sesion en el cliente.
 *
 * Devuelve `cargando` hasta que se ejecuta en el navegador: leer
 * `sessionStorage` durante el renderizado en servidor produciria una
 * discrepancia de hidratacion.
 */
export function useSesion(): { sesion: SesionAficionado | null; cargando: boolean; salir: () => void } {
  const [sesion, setSesion] = useState<SesionAficionado | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setSesion(leerSesion());
    setCargando(false);
  }, []);

  const salir = useCallback(() => {
    borrarSesion();
    setSesion(null);
  }, []);

  return { sesion, cargando, salir };
}
