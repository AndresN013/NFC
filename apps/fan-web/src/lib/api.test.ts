import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, peticion, verificarToken, obtenerContenido } from './api';

/**
 * Pruebas del cliente de API.
 *
 * Verifican el contrato del cliente, no el del servidor (eso lo cubren las
 * pruebas de integracion de la API contra Postgres real).
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(cuerpo),
  };
}

describe('peticion', () => {
  it('envia el cuerpo como JSON', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { ok: true }));

    await peticion('/ruta', { method: 'POST', body: { a: 1 } });

    const [, opciones] = fetchMock.mock.calls[0]!;
    expect(opciones.method).toBe('POST');
    expect(opciones.headers['content-type']).toBe('application/json');
    expect(opciones.body).toBe('{"a":1}');
  });

  it('adjunta el token como Bearer cuando se proporciona', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));

    await peticion('/ruta', { token: 'tok-123' });

    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer tok-123');
  });

  it('NO adjunta cabecera de autorizacion sin token', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));

    await peticion('/ruta');

    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBeUndefined();
  });

  it('no cachea por defecto: cada verificacion es un evento distinto', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));

    await peticion('/ruta');

    expect(fetchMock.mock.calls[0]![1].cache).toBe('no-store');
  });

  it('reenvia las cabeceras indicadas', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));

    await peticion('/ruta', { forward: { 'accept-language': 'es-EC', 'save-data': 'on' } });

    const headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers['accept-language']).toBe('es-EC');
    expect(headers['save-data']).toBe('on');
  });

  it('traduce un error de la API a ApiError con su codigo', async () => {
    fetchMock.mockResolvedValue(
      respuesta(409, { error: { code: 'CONFLICT', message: 'Ya existe un titular' } }),
    );

    await expect(peticion('/ruta')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Ya existe un titular',
    });
  });

  it('usa un mensaje generico si la API no envia uno', async () => {
    fetchMock.mockResolvedValue(respuesta(500, {}));

    await expect(peticion('/ruta')).rejects.toBeInstanceOf(ApiError);
    await expect(peticion('/ruta')).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('tolera una respuesta vacia', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => '' });

    await expect(peticion('/ruta')).resolves.toBeNull();
  });
});

describe('verificarToken', () => {
  it('envia el metodo declarado, que fija el techo de confianza en el servidor', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { trustLevel: 'IDENTIFIED_ONLY' }));

    await verificarToken('TOK', 'QR_CODE');

    const cuerpo = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(cuerpo.method).toBe('QR_CODE');
    expect(cuerpo.token).toBe('TOK');
  });

  it('no inventa un mensaje autenticado que el cliente no puede producir', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));

    await verificarToken('TOK', 'NFC_STATIC_URL');

    const cuerpo = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(cuerpo.authenticatedMessage).toBeUndefined();
    expect(cuerpo.reportedCounter).toBeUndefined();
  });

  it('usa POST, de modo que el token no acaba en un registro de acceso', async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));

    await verificarToken('TOK-SECRETO', 'NFC_STATIC_URL');

    const [url, opciones] = fetchMock.mock.calls[0]!;
    expect(opciones.method).toBe('POST');
    expect(String(url)).not.toContain('TOK-SECRETO');
  });
});

describe('obtenerContenido', () => {
  it('propaga el nivel de confianza y el modo de bajo consumo', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { items: [] }));

    await obtenerContenido('unidad-1', { trustLevel: 'IDENTIFIED_ONLY', lowData: true });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('trustLevel=IDENTIFIED_ONLY');
    expect(url).toContain('lowData=1');
  });

  it('no anade parametros vacios', async () => {
    fetchMock.mockResolvedValue(respuesta(200, { items: [] }));

    await obtenerContenido('unidad-1');

    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('?');
  });
});
