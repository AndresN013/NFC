import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_ROLES,
  hasAccess,
  PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES,
  permissionsForRoles,
  ROLE_PERMISSIONS,
  ROLES,
  roleHasPermission,
} from './rbac.js';

describe('matriz de roles', () => {
  it('todos los roles declarados tienen permisos definidos', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it('un patrocinador jamas accede a datos personales de aficionados', () => {
    for (const permission of PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES) {
      expect(roleHasPermission('SPONSOR', permission)).toBe(false);
    }
  });

  it('ningun rol externo obtiene permisos sobre datos personales', () => {
    for (const role of EXTERNAL_ROLES) {
      for (const permission of PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES) {
        expect(roleHasPermission(role, permission)).toBe(false);
      }
    }
  });

  it('el patrocinador solo ve analitica con alcance de campana', () => {
    expect(roleHasPermission('SPONSOR', 'analytics:campaign_scoped')).toBe(true);
    expect(roleHasPermission('SPONSOR', 'analytics:read')).toBe(false);
  });

  it('el operario de produccion no puede revocar ni activar unidades', () => {
    expect(roleHasPermission('PRODUCTION_OPERATOR', 'production:revoke')).toBe(false);
    expect(roleHasPermission('PRODUCTION_OPERATOR', 'production:activate')).toBe(false);
    expect(roleHasPermission('PRODUCTION_OPERATOR', 'production:write')).toBe(true);
  });

  it('el operario no puede leer el UID completo de los chips', () => {
    expect(roleHasPermission('PRODUCTION_OPERATOR', 'chips:read')).toBe(false);
  });

  it('soporte no puede revocar unidades ni escribir en chips', () => {
    expect(roleHasPermission('SUPPORT', 'production:revoke')).toBe(false);
    expect(roleHasPermission('SUPPORT', 'chips:write')).toBe(false);
  });

  it('el administrador del club no accede a datos personales de aficionados', () => {
    expect(roleHasPermission('CLUB_ADMIN', 'fans:read')).toBe(false);
    expect(roleHasPermission('CLUB_ADMIN', 'ownership:read')).toBe(false);
  });

  it('el superadministrador tiene todos los permisos', () => {
    expect(permissionsForRoles(['SUPERADMIN']).size).toBe(ROLE_PERMISSIONS.SUPERADMIN.length);
  });
});

describe('evaluacion de acceso con alcance', () => {
  it('un rol global cubre cualquier ambito', () => {
    const ok = hasAccess([{ role: 'MARATHON_ADMIN', scopeType: 'GLOBAL', scopeId: null }], {
      permission: 'catalog:write',
      scopeType: 'CLUB',
      scopeId: 'club-1',
    });
    expect(ok).toBe(true);
  });

  it('un rol con alcance de club no alcanza a otro club', () => {
    const assignments = [{ role: 'CLUB_ADMIN' as const, scopeType: 'CLUB' as const, scopeId: 'club-1' }];
    expect(
      hasAccess(assignments, { permission: 'content:write', scopeType: 'CLUB', scopeId: 'club-1' }),
    ).toBe(true);
    expect(
      hasAccess(assignments, { permission: 'content:write', scopeType: 'CLUB', scopeId: 'club-2' }),
    ).toBe(false);
  });

  it('un rol con alcance rechaza comprobaciones sin ambito declarado', () => {
    const assignments = [{ role: 'SPONSOR' as const, scopeType: 'CAMPAIGN' as const, scopeId: 'c-1' }];
    expect(hasAccess(assignments, { permission: 'analytics:campaign_scoped' })).toBe(false);
  });

  it('un permiso ausente del rol se rechaza aunque el alcance coincida', () => {
    const assignments = [{ role: 'SPONSOR' as const, scopeType: 'CAMPAIGN' as const, scopeId: 'c-1' }];
    expect(
      hasAccess(assignments, {
        permission: 'fans:read',
        scopeType: 'CAMPAIGN',
        scopeId: 'c-1',
      }),
    ).toBe(false);
  });

  it('sin asignaciones no hay acceso', () => {
    expect(hasAccess([], { permission: 'catalog:read' })).toBe(false);
  });
});
