import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  buildQueryString,
  createApiClient,
  filenameFromDisposition,
  isTruncatedExport,
} from './api-client';

/** Respuesta JSON minima, suficiente para el cliente. */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('buildQueryString', () => {
  it('omite valores vacios, nulos e indefinidos', () => {
    const query = buildQueryString({ state: '', club: null, order: undefined, page: 2 });
    expect(query).toBe('?page=2');
  });

  it('devuelve cadena vacia cuando no queda ningun parametro', () => {
    expect(buildQueryString({ state: '' })).toBe('');
    expect(buildQueryString(undefined)).toBe('');
  });

  it('codifica los valores', () => {
    expect(buildQueryString({ q: 'MEV 34&7' })).toBe('?q=MEV+34%267');
  });

  it('acepta false como valor real y no como vacio', () => {
    expect(buildQueryString({ active: false })).toBe('?active=false');
  });
});

describe('cabeceras', () => {
  it('envia el token como Bearer y pide JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: '/base',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => 'token-de-prueba',
    });

    await client.get('/admin/me');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/base/admin/me');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-de-prueba');
    expect(headers.accept).toBe('application/json');
    // Sin cuerpo no debe declararse content-type.
    expect(headers['content-type']).toBeUndefined();
  });

  it('no envia Authorization cuando no hay sesion', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => null,
    });

    await client.get('/admin/clubs');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('serializa el cuerpo como JSON y declara el content-type', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'nuevo' }, { status: 201 }));
    const client = createApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => 'tok',
    });

    await client.post('/admin/orders', { code: 'OP-1', plannedUnits: 10 });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{"code":"OP-1","plannedUnits":10}');
  });

  it('no arrastra cookies: el token viaja solo en la cabecera', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.get('/admin/me');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('omit');
  });
});

describe('manejo de errores', () => {
  it('ante un 401 limpia la sesion y lanza ApiError', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'x' } }, { status: 401 }),
    );
    const client = createApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => 'caducado',
      onUnauthorized,
    });

    await expect(client.get('/admin/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('el 401 no dispara reintento', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }));
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.get('/admin/me')).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('un 403 no cierra la sesion: falta permiso, no sobra caducidad', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'FORBIDDEN', message: 'No tiene permiso para esta operacion' } },
        { status: 403 },
      ),
    );
    const client = createApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
    });

    const error = await client.get('/admin/chips').catch((cause: unknown) => cause);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isForbidden).toBe(true);
    expect((error as ApiError).code).toBe('FORBIDDEN');
    expect((error as ApiError).message).toBe('No tiene permiso para esta operacion');
  });

  it('propaga el mensaje de la API en otros errores', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'BAD_REQUEST', message: 'Falta el motivo' } }, { status: 400 }),
    );
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client
      .post('/admin/units/1/revoke')
      .catch((cause: unknown) => cause)) as ApiError;
    expect(error.status).toBe(400);
    expect(error.message).toBe('Falta el motivo');
  });

  it('sobrevive a un error sin cuerpo JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('pasarela caida', { status: 502 }));
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client.get('/admin/me').catch((cause: unknown) => cause)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.code).toBe('HTTP_502');
  });

  it('convierte un fallo de red en ApiError con codigo NETWORK', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('failed to fetch');
    });
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client.get('/admin/me').catch((cause: unknown) => cause)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NETWORK');
    expect(error.status).toBe(0);
  });
});

describe('deteccion de CSV truncado', () => {
  it('reconoce x-export-truncated: true', () => {
    expect(isTruncatedExport(new Headers({ 'x-export-truncated': 'true' }))).toBe(true);
    expect(isTruncatedExport(new Headers({ 'x-export-truncated': 'TRUE' }))).toBe(true);
    expect(isTruncatedExport(new Headers({ 'x-export-truncated': ' true ' }))).toBe(true);
  });

  it('no marca truncado cuando la cabecera dice false o no viene', () => {
    expect(isTruncatedExport(new Headers({ 'x-export-truncated': 'false' }))).toBe(false);
    // Ausencia de cabecera: se asume completo, que es lo que dice la API.
    expect(isTruncatedExport(new Headers())).toBe(false);
  });

  it('getCsv devuelve texto, nombre de fichero y marca de truncado', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('publicRef,state\nMEV-1,ACTIVATED', {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="unidades.csv"',
            'x-export-truncated': 'true',
          },
        }),
    );
    const client = createApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => 'tok',
    });

    const result = await client.getCsv('/admin/units', { format: 'csv', state: 'ACTIVATED' });

    expect(result.filename).toBe('unidades.csv');
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('MEV-1');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('format=csv');
    expect(url).toContain('state=ACTIVATED');
  });

  it('getCsv marca completo cuando la API no avisa de truncado', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('a,b\n1,2', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="auditoria.csv"' },
        }),
    );
    const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await client.getCsv('/admin/audit', { format: 'csv' });
    expect(result.truncated).toBe(false);
    expect(result.filename).toBe('auditoria.csv');
  });

  it('usa un nombre de respaldo si falta content-disposition', () => {
    expect(filenameFromDisposition(new Headers(), 'exportacion.csv')).toBe('exportacion.csv');
    expect(
      filenameFromDisposition(
        new Headers({ 'content-disposition': 'attachment; filename=unidades.csv' }),
        'x.csv',
      ),
    ).toBe('unidades.csv');
  });
});
