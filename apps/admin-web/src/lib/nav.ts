/**
 * Mapa de navegacion del panel.
 *
 * Cada entrada declara el permiso que la API exige para su endpoint principal.
 * Se usa para NO mostrar enlaces inutiles; no sustituye a la comprobacion del
 * servidor (ver `permissions.ts`).
 */

import type { Permission } from '@mev/domain/browser';

export interface NavItem {
  href: string;
  label: string;
  /** Permiso de lectura que la API exige para la pagina. */
  permission: Permission;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'General',
    items: [{ href: '/', label: 'Inicio', permission: 'analytics:read' }],
  },
  {
    title: 'Administracion',
    items: [
      { href: '/usuarios', label: 'Usuarios', permission: 'users:read' },
      { href: '/auditoria', label: 'Auditoria', permission: 'audit:read' },
    ],
  },
  {
    title: 'Catalogo',
    items: [
      { href: '/catalogo/clubes', label: 'Clubes', permission: 'catalog:read' },
      { href: '/catalogo/modelos', label: 'Modelos', permission: 'catalog:read' },
      { href: '/catalogo/jugadores', label: 'Jugadores', permission: 'catalog:read' },
    ],
  },
  {
    title: 'Produccion',
    items: [
      {
        href: '/produccion/programar',
        label: 'Grabar chip NFC',
        permission: 'production:activate',
      },
      { href: '/produccion/ordenes', label: 'Ordenes', permission: 'production:read' },
      { href: '/produccion/lotes', label: 'Lotes', permission: 'production:read' },
      { href: '/produccion/unidades', label: 'Unidades', permission: 'production:read' },
      { href: '/produccion/dispositivos', label: 'Dispositivos', permission: 'devices:read' },
      { href: '/chips', label: 'Chips NFC', permission: 'chips:read' },
    ],
  },
  {
    title: 'Riesgo y atencion',
    items: [
      { href: '/riesgo/alertas', label: 'Alertas', permission: 'alerts:read' },
      { href: '/soporte/casos', label: 'Casos de soporte', permission: 'support:read' },
      { href: '/privacidad/solicitudes', label: 'Solicitudes de privacidad', permission: 'privacy:read' },
    ],
  },
  {
    title: 'Contenido',
    items: [{ href: '/contenido', label: 'Contenido dinamico', permission: 'content:read' }],
  },
];
