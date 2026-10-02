/**
 * Sesion del panel.
 *
 * El token vive en memoria y se replica en `sessionStorage`, nunca en
 * `localStorage`: asi muere al cerrar la pestana y no queda un token de
 * administrador durmiendo en el disco del navegador a la espera de que alguien
 * abra ese equipo manana.
 *
 * `sessionStorage` sigue siendo legible por cualquier script del mismo origen,
 * asi que no es una defensa contra XSS; es una reduccion de la ventana de
 * exposicion. La defensa real es que el servidor caduca y revoca las sesiones.
 */

import type { Permission } from '@mev/domain/browser';
import type { RoleAssignmentDto } from './types';

export const SESSION_STORAGE_KEY = 'mev.admin.session';

export interface AdminSession {
  token: string;
  expiresAt: string;
  user: { id: string; email: string; displayName: string; mfaEnabled: boolean };
  roles: RoleAssignmentDto[];
  /**
   * Permisos que la interfaz usa para mostrar u ocultar secciones.
   * NO es control de acceso. Ver `permissions.ts`.
   */
  permissions: Permission[];
}

/** Subconjunto de `Storage` que realmente se usa, para poder inyectarlo en pruebas. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionStore {
  get(): AdminSession | null;
  set(session: AdminSession): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

/** Valida la forma de lo leido: `sessionStorage` puede traer basura de otra version. */
export function parseSession(raw: string | null): AdminSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<AdminSession>;
    if (typeof candidate.token !== 'string' || candidate.token.length === 0) return null;
    if (typeof candidate.expiresAt !== 'string') return null;
    if (typeof candidate.user !== 'object' || candidate.user === null) return null;
    if (!Array.isArray(candidate.permissions)) return null;
    if (!Array.isArray(candidate.roles)) return null;
    return candidate as AdminSession;
  } catch {
    return null;
  }
}

/** Una sesion caducada se trata como inexistente aunque siga en el almacen. */
export function isExpired(session: AdminSession, now: number = Date.now()): boolean {
  const expiry = Date.parse(session.expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

export function createSessionStore(storage: StorageLike | null): SessionStore {
  let current: AdminSession | null = null;
  let hydrated = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    get() {
      if (!hydrated) {
        hydrated = true;
        current = storage ? parseSession(storage.getItem(SESSION_STORAGE_KEY)) : null;
      }
      if (current && isExpired(current)) {
        current = null;
        storage?.removeItem(SESSION_STORAGE_KEY);
      }
      return current;
    },
    set(session) {
      hydrated = true;
      current = session;
      storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      notify();
    },
    clear() {
      hydrated = true;
      current = null;
      storage?.removeItem(SESSION_STORAGE_KEY);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Almacen unico del navegador. En el servidor (render inicial de Next) no hay
 * `sessionStorage`: el almacen queda vacio y las paginas piden iniciar sesion
 * hasta que hidrata en el cliente.
 */
export const sessionStore: SessionStore = createSessionStore(
  typeof window === 'undefined' ? null : window.sessionStorage,
);
