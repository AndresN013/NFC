'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, buildQueryString, type Query } from '@/lib/api-client';
import { useSession } from '@/components/SessionProvider';

export interface QueryState<T> {
  data: T | null;
  error: ApiError | null;
  /** Cierto durante la primera carga y durante cada recarga. */
  loading: boolean;
  reload(): void;
}

/**
 * Lee un endpoint del panel y expone los tres estados que toda lista necesita:
 * cargando, vacio y error. `path` a null aplaza la peticion (por ejemplo
 * mientras no hay sesion o falta un parametro de la ruta).
 */
export function useApiQuery<T>(path: string | null, query?: Query): QueryState<T> {
  const { api, session } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);

  // La consulta se compara por su forma serializada: un objeto nuevo en cada
  // render no debe provocar una peticion nueva.
  const queryKey = buildQueryString(query);
  const hasSession = Boolean(session);

  useEffect(() => {
    if (path === null || !hasSession) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);

    api
      .request<T>(`${path}${queryKey}`, { signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setData(null);
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(0, 'UNKNOWN', 'Ocurrio un error inesperado.'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [api, path, queryKey, hasSession, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading, reload };
}
