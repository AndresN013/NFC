import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type Permission } from '@mev/domain/browser';
import {
  hasAllUiPermissions,
  hasAnyUiPermission,
  hasUiPermission,
  scopedCampaignIds,
  uiPermissionsFromAssignments,
} from './permissions';
import { NAV_GROUPS } from './nav';

describe('guardia de permisos de la interfaz', () => {
  it('reconoce un permiso concedido', () => {
    expect(hasUiPermission(['users:read', 'audit:read'], 'users:read')).toBe(true);
  });

  it('niega un permiso ausente', () => {
    expect(hasUiPermission(['users:read'], 'users:write')).toBe(false);
  });

  it('trata la ausencia de lista como ausencia de permisos', () => {
    expect(hasUiPermission(undefined, 'users:read')).toBe(false);
    expect(hasUiPermission([], 'users:read')).toBe(false);
  });

  it('hasAllUiPermissions exige todos', () => {
    const granted: Permission[] = ['production:read', 'production:write'];
    expect(hasAllUiPermissions(granted, ['production:read', 'production:write'])).toBe(true);
    expect(hasAllUiPermissions(granted, ['production:read', 'production:revoke'])).toBe(false);
  });

  it('hasAnyUiPermission basta con uno', () => {
    expect(hasAnyUiPermission(['chips:read'], ['chips:read', 'chips:write'])).toBe(true);
    expect(hasAnyUiPermission(['catalog:read'], ['chips:read', 'chips:write'])).toBe(false);
  });

  it('una lista vacia de requisitos: todos la cumplen, ninguno la cumple parcialmente', () => {
    expect(hasAllUiPermissions([], [])).toBe(true);
    expect(hasAnyUiPermission([], [])).toBe(false);
  });
});

describe('respaldo de permisos a partir de los roles del login', () => {
  it('un SPONSOR solo obtiene campanas y metricas de su campana', () => {
    const permissions = uiPermissionsFromAssignments([
      { role: 'SPONSOR', scopeType: 'CAMPAIGN', scopeId: 'camp-1' },
    ]);

    expect(permissions).toContain('analytics:campaign_scoped');
    expect(permissions).toContain('campaigns:read');
    // La regla de privacidad: un patrocinador nunca ve datos de aficionados.
    expect(permissions).not.toContain('fans:read');
    expect(permissions).not.toContain('ownership:read');
    expect(permissions).not.toContain('chips:read');
    expect(permissions).not.toContain('production:read');
    expect(permissions).not.toContain('analytics:read');
  });

  it('un operario de produccion no obtiene lectura de chips', () => {
    const permissions = uiPermissionsFromAssignments([
      { role: 'PRODUCTION_OPERATOR', scopeType: 'GLOBAL', scopeId: null },
    ]);

    expect(permissions).toContain('production:write');
    expect(permissions).not.toContain('chips:read');
    expect(permissions).not.toContain('users:read');
  });

  it('acumula los permisos de varios roles sin duplicar', () => {
    const permissions = uiPermissionsFromAssignments([
      { role: 'SUPPORT', scopeType: 'GLOBAL', scopeId: null },
      { role: 'CONTENT_AGENCY', scopeType: 'GLOBAL', scopeId: null },
    ]);

    expect(permissions).toContain('support:read');
    expect(permissions).toContain('content:write');
    expect(new Set(permissions).size).toBe(permissions.length);
  });

  it('coincide con la matriz del dominio para cada rol', () => {
    for (const [role, expected] of Object.entries(ROLE_PERMISSIONS)) {
      const derived = uiPermissionsFromAssignments([
        { role: role as keyof typeof ROLE_PERMISSIONS, scopeType: 'GLOBAL', scopeId: null },
      ]);
      expect(new Set(derived)).toEqual(new Set(expected));
    }
  });
});

describe('alcance de campana', () => {
  it('extrae los ids de campana de las asignaciones', () => {
    expect(
      scopedCampaignIds([
        { role: 'SPONSOR', scopeType: 'CAMPAIGN', scopeId: 'camp-1' },
        { role: 'CLUB_ADMIN', scopeType: 'CLUB', scopeId: 'club-1' },
        { role: 'SUPERADMIN', scopeType: 'GLOBAL', scopeId: null },
      ]),
    ).toEqual(['camp-1']);
  });

  it('ignora una asignacion de campana sin id', () => {
    expect(scopedCampaignIds([{ role: 'SPONSOR', scopeType: 'CAMPAIGN', scopeId: null }])).toEqual(
      [],
    );
  });
});

describe('navegacion filtrada por permisos', () => {
  /** Reproduce lo que hace la barra lateral, para probarlo sin montar React. */
  function visibleLinks(permissions: Permission[]): string[] {
    return NAV_GROUPS.flatMap((group) =>
      group.items.filter((item) => hasUiPermission(permissions, item.permission)).map((i) => i.href),
    );
  }

  it('un patrocinador no ve ninguna seccion operativa del panel', () => {
    const permissions = uiPermissionsFromAssignments([
      { role: 'SPONSOR', scopeType: 'CAMPAIGN', scopeId: 'camp-1' },
    ]);
    expect(visibleLinks(permissions)).toEqual([]);
  });

  it('un operario ve catalogo y produccion, pero no chips ni usuarios', () => {
    const permissions = uiPermissionsFromAssignments([
      { role: 'PRODUCTION_OPERATOR', scopeType: 'GLOBAL', scopeId: null },
    ]);
    const links = visibleLinks(permissions);

    expect(links).toContain('/produccion/unidades');
    expect(links).toContain('/catalogo/clubes');
    expect(links).not.toContain('/chips');
    expect(links).not.toContain('/usuarios');
    expect(links).not.toContain('/auditoria');
    expect(links).not.toContain('/privacidad/solicitudes');
  });

  it('un superadministrador ve todas las secciones', () => {
    const permissions = uiPermissionsFromAssignments([
      { role: 'SUPERADMIN', scopeType: 'GLOBAL', scopeId: null },
    ]);
    const total = NAV_GROUPS.reduce((sum, group) => sum + group.items.length, 0);
    expect(visibleLinks(permissions)).toHaveLength(total);
  });
});
