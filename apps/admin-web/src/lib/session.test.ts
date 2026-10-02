import { describe, expect, it, vi } from 'vitest';
import {
  createSessionStore,
  isExpired,
  parseSession,
  SESSION_STORAGE_KEY,
  type AdminSession,
  type StorageLike,
} from './session';

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function session(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    token: 'tok-1',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: 'u1', email: 'a@b.local', displayName: 'Ana', mfaEnabled: false },
    roles: [{ role: 'SUPERADMIN', scopeType: 'GLOBAL', scopeId: null }],
    permissions: ['users:read'],
    ...overrides,
  };
}

describe('almacen de sesion', () => {
  it('guarda y recupera la sesion del almacen inyectado', () => {
    const storage = fakeStorage();
    const store = createSessionStore(storage);

    store.set(session());

    expect(store.get()?.token).toBe('tok-1');
    // Se escribe bajo una clave propia del panel, en sessionStorage.
    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(true);
  });

  it('al limpiar borra tambien lo persistido', () => {
    const storage = fakeStorage();
    const store = createSessionStore(storage);
    store.set(session());

    store.clear();

    expect(store.get()).toBeNull();
    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it('hidrata desde el almacen en el primer acceso', () => {
    const storage = fakeStorage();
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session({ token: 'desde-almacen' })));

    expect(createSessionStore(storage).get()?.token).toBe('desde-almacen');
  });

  it('descarta y borra una sesion caducada', () => {
    const storage = fakeStorage();
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(session({ expiresAt: '2020-01-01T00:00:00.000Z' })),
    );
    const store = createSessionStore(storage);

    expect(store.get()).toBeNull();
    expect(storage.map.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it('funciona sin almacen: en el servidor no hay sessionStorage', () => {
    const store = createSessionStore(null);
    store.set(session());
    expect(store.get()?.token).toBe('tok-1');
  });

  it('avisa a los suscriptores al entrar y al salir', () => {
    const store = createSessionStore(fakeStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(session());
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.set(session());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('parseSession', () => {
  it('rechaza basura de una version anterior', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('{no es json')).toBeNull();
    expect(parseSession('"texto"')).toBeNull();
    expect(parseSession('{}')).toBeNull();
    expect(parseSession(JSON.stringify({ token: '' }))).toBeNull();
    expect(parseSession(JSON.stringify({ token: 'x', expiresAt: 'y' }))).toBeNull();
  });

  it('acepta una sesion completa', () => {
    expect(parseSession(JSON.stringify(session()))?.token).toBe('tok-1');
  });
});

describe('isExpired', () => {
  it('compara contra la hora dada', () => {
    const value = session({ expiresAt: '2026-09-17T12:00:00.000Z' });
    expect(isExpired(value, Date.parse('2026-09-17T11:59:00.000Z'))).toBe(false);
    expect(isExpired(value, Date.parse('2026-09-17T12:00:01.000Z'))).toBe(true);
  });

  it('una fecha ilegible no se considera caducada: decide el servidor', () => {
    expect(isExpired(session({ expiresAt: 'basura' }))).toBe(false);
  });
});
