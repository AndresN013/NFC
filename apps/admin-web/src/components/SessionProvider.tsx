'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import type { Permission } from '@mev/domain/browser';
import { ApiError, createApiClient, type ApiClient } from '@/lib/api-client';
import { sessionStore, type AdminSession } from '@/lib/session';
import { uiPermissionsFromAssignments } from '@/lib/permissions';
import type { LoginResponse, MeResponse } from '@/lib/types';

interface SessionContextValue {
  session: AdminSession | null;
  /** `false` mientras no se ha hidratado en el cliente. */
  ready: boolean;
  api: ApiClient;
  permissions: Permission[];
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const EMPTY_PERMISSIONS: Permission[] = [];

export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const router = useRouter();

  const session = useSyncExternalStore(
    (listener) => sessionStore.subscribe(listener),
    () => sessionStore.get(),
    // En el render del servidor no hay sessionStorage: no hay sesion todavia.
    () => null,
  );

  // `ready` distingue "no hay sesion" de "aun no se ha leido sessionStorage",
  // para no mandar a /entrar a alguien que si tenia sesion.
  const ready = useSyncExternalStore(
    (listener) => sessionStore.subscribe(listener),
    () => true,
    () => false,
  );

  const onUnauthorized = useCallback(() => {
    // 401: la sesion caduco o el servidor la revoco. Se borra el token y se
    // vuelve a la entrada; no se intenta refrescar nada.
    sessionStore.clear();
    router.replace('/entrar');
  }, [router]);

  const api = useMemo(
    () =>
      createApiClient({
        getToken: () => sessionStore.get()?.token ?? null,
        onUnauthorized,
      }),
    [onUnauthorized],
  );

  const login = useCallback(async (email: string, password: string) => {
    // El cliente de login no lleva token ni debe reaccionar a un 401: un 401
    // aqui significa "credenciales incorrectas", no "sesion caducada".
    const anonymous = createApiClient({ getToken: () => null });
    const result = await anonymous.post<LoginResponse>('/admin/login', { email, password });

    const assignments = result.user.roles;
    let permissions: Permission[];
    try {
      const me = await createApiClient({ getToken: () => result.token }).get<MeResponse>(
        '/admin/me',
      );
      permissions = me.permissions;
    } catch (error) {
      // `GET /admin/me` exige `catalog:read`, que un SPONSOR no tiene: ese rol
      // recibe 403 al pedir su propio perfil. Se derivan los permisos de las
      // asignaciones del login para poder pintar su menu. Sigue siendo solo
      // comodidad de interfaz: el servidor decide en cada peticion.
      if (error instanceof ApiError && error.isForbidden) {
        permissions = uiPermissionsFromAssignments(assignments);
      } else {
        throw error;
      }
    }

    sessionStore.set({
      token: result.token,
      expiresAt: result.expiresAt,
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        mfaEnabled: result.user.mfaEnabled,
      },
      roles: assignments,
      permissions,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      // `POST /admin/logout` tambien exige `catalog:read`; si falla, la sesion
      // local se borra igual. Caducara sola en el servidor.
      await api.post('/admin/logout');
    } catch {
      // Cerrar sesion nunca debe quedarse a medias por un error de red.
    }
    sessionStore.clear();
    router.replace('/entrar');
  }, [api, router]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      ready,
      api,
      permissions: session?.permissions ?? EMPTY_PERMISSIONS,
      login,
      logout,
    }),
    [session, ready, api, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession debe usarse dentro de SessionProvider');
  return context;
}
