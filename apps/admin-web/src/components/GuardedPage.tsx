'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Permission } from '@mev/domain/browser';
import { useSession } from './SessionProvider';
import { hasAllUiPermissions } from '@/lib/permissions';
import { Callout } from './ui';

/**
 * Envoltura de pagina.
 *
 * Hace dos cosas, ninguna de ellas seguridad:
 *  1. si no hay sesion, manda a `/entrar` (evita una pagina en blanco);
 *  2. si la sesion no declara los permisos de la pagina, explica por que no se
 *     muestra en vez de disparar peticiones que el servidor va a rechazar.
 *
 * La autorizacion real ocurre en la API: aunque alguien fuerce este componente,
 * cada endpoint vuelve a comprobar el permiso contra su sesion y responde 403.
 */
export function GuardedPage({
  permissions: required,
  children,
}: {
  /** Permisos que la API exige para los datos de esta pagina. */
  permissions: readonly Permission[];
  children: React.ReactNode;
}): React.ReactElement | null {
  const { session, ready, permissions } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace('/entrar');
  }, [ready, session, router]);

  if (!ready) {
    return (
      <p role="status" aria-live="polite">
        Cargando…
      </p>
    );
  }

  if (!session) {
    return (
      <p role="status" aria-live="polite">
        Redirigiendo al inicio de sesion…
      </p>
    );
  }

  if (!hasAllUiPermissions(permissions, required)) {
    return (
      <Callout variant="aviso" title="Sección no disponible para su rol">
        <p>
          Su cuenta no tiene los permisos que esta sección necesita (
          {required.join(', ')}). Si cree que le corresponden, pídalos a un administrador.
        </p>
      </Callout>
    );
  }

  return <>{children}</>;
}
