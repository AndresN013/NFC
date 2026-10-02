'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from '@/lib/nav';
import { hasUiPermission, scopedCampaignIds } from '@/lib/permissions';
import { useSession } from './SessionProvider';
import styles from './AppShell.module.css';

/**
 * Marco de la aplicacion: barra lateral + contenido.
 *
 * La barra solo lista las secciones cuyo permiso declara la sesion. Es una
 * comodidad para no ofrecer callejones sin salida; no protege nada, porque cada
 * endpoint del servidor vuelve a comprobar el permiso (ver `permissions.ts`).
 */
export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const { session, permissions, logout } = useSession();

  // La pantalla de entrada se muestra sin marco: no hay sesion que navegar.
  if (pathname === '/entrar' || !session) {
    return <div className={styles.marcoSinMenu}>{children}</div>;
  }

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasUiPermission(permissions, item.permission)),
  })).filter((group) => group.items.length > 0);

  // Un patrocinador solo tiene su propia campana: se enlaza directamente.
  const campaigns = hasUiPermission(permissions, 'analytics:campaign_scoped')
    ? scopedCampaignIds(session.roles)
    : [];

  const isActive = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className={styles.marco}>
      <a className="saltarContenido" href="#contenido">
        Saltar al contenido principal
      </a>

      <nav className={styles.lateral} aria-label="Navegación principal">
        <p className={styles.marca}>
          Escudo Vivo
          <span className={styles.marcaDetalle}>Panel administrativo</span>
        </p>

        <div>
          {groups.map((group) => (
            <div className={styles.grupo} key={group.title}>
              <h2 className={styles.grupoTitulo}>{group.title}</h2>
              <ul className={styles.lista}>
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`${styles.enlace} ${active ? styles.enlaceActivo : ''}`}
                        // Refuerzo para lectores de pantalla: el color no basta.
                        aria-current={active ? 'page' : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {campaigns.length > 0 ? (
            <div className={styles.grupo}>
              <h2 className={styles.grupoTitulo}>Patrocinio</h2>
              <ul className={styles.lista}>
                {campaigns.map((campaignId) => {
                  const href = `/patrocinador/campana/${campaignId}`;
                  const active = pathname === href;
                  return (
                    <li key={campaignId}>
                      <Link
                        href={href}
                        className={`${styles.enlace} ${active ? styles.enlaceActivo : ''}`}
                        aria-current={active ? 'page' : undefined}
                      >
                        Mi campaña
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {groups.length === 0 && campaigns.length === 0 ? (
            <p className={styles.sinAcceso}>
              Su rol no tiene secciones asignadas en este panel.
            </p>
          ) : null}
        </div>

        <div className={styles.pie}>
          <span className={styles.usuario}>
            {session.user.displayName}
            <span className={styles.usuarioCorreo}>{session.user.email}</span>
          </span>
          <button type="button" className={styles.botonSalir} onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </div>
      </nav>

      <main className={styles.contenido} id="contenido">
        {children}
      </main>
    </div>
  );
}
