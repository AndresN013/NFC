/**
 * Roles y permisos.
 *
 * El modelo es RBAC con alcance (scope): un permiso se concede sobre un ambito
 * (global, organizacion, club o campana). Un patrocinador nunca obtiene un
 * permiso que toque datos personales de aficionados; su unico acceso es a
 * metricas agregadas de SU campana.
 */

export const ROLES = [
  'SUPERADMIN',
  'MARATHON_ADMIN',
  'CLUB_ADMIN',
  'PRODUCTION_OPERATOR',
  'SUPPORT',
  'CONTENT_AGENCY',
  'SPONSOR',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Administracion
  'users:read',
  'users:write',
  'roles:assign',
  'audit:read',

  // Catalogo
  'catalog:read',
  'catalog:write',

  // Produccion
  'production:read',
  'production:write',
  'production:activate',
  'production:quarantine',
  'production:revoke',
  'devices:read',
  'devices:write',

  // Chips: `chips:read` muestra el UID completo. Es un permiso sensible.
  'chips:read',
  'chips:write',

  // Aficionados y propiedad
  'fans:read',
  'ownership:read',
  'ownership:write',

  // Contenido y campanas
  'content:read',
  'content:write',
  'campaigns:read',
  'campaigns:write',
  'rewards:read',
  'rewards:write',

  // Riesgo
  'alerts:read',
  'alerts:write',

  // Soporte y privacidad
  'support:read',
  'support:write',
  'privacy:read',
  'privacy:write',

  // Analitica
  'analytics:read',
  /** Metricas agregadas restringidas a la campana propia. Sin datos personales. */
  'analytics:campaign_scoped',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPERADMIN: PERMISSIONS,

  MARATHON_ADMIN: [
    'users:read',
    'users:write',
    'roles:assign',
    'audit:read',
    'catalog:read',
    'catalog:write',
    'production:read',
    'production:write',
    'production:activate',
    'production:quarantine',
    'production:revoke',
    'devices:read',
    'devices:write',
    'chips:read',
    'chips:write',
    'fans:read',
    'ownership:read',
    'ownership:write',
    'content:read',
    'content:write',
    'campaigns:read',
    'campaigns:write',
    'rewards:read',
    'rewards:write',
    'alerts:read',
    'alerts:write',
    'support:read',
    'support:write',
    'privacy:read',
    'privacy:write',
    'analytics:read',
  ],

  // El club ve su catalogo, su contenido y metricas agregadas. No toca produccion
  // ni el UID de los chips ni los datos personales de los aficionados.
  CLUB_ADMIN: [
    'catalog:read',
    'content:read',
    'content:write',
    'campaigns:read',
    'rewards:read',
    'alerts:read',
    'analytics:read',
    'production:read',
  ],

  // El operario solo necesita ejecutar la linea de produccion.
  PRODUCTION_OPERATOR: [
    'catalog:read',
    'production:read',
    'production:write',
    'production:quarantine',
    'chips:write',
  ],

  // Soporte atiende casos y ve propiedad, pero no puede revocar ni reprogramar.
  SUPPORT: [
    'catalog:read',
    'production:read',
    'fans:read',
    'ownership:read',
    'ownership:write',
    'alerts:read',
    'support:read',
    'support:write',
    'privacy:read',
    'privacy:write',
  ],

  CONTENT_AGENCY: ['catalog:read', 'content:read', 'content:write', 'campaigns:read'],

  // Un patrocinador SOLO recibe agregados de su campana. Sin `fans:read`,
  // sin `ownership:read`, sin `analytics:read` global.
  SPONSOR: ['campaigns:read', 'analytics:campaign_scoped'],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) set.add(permission);
  }
  return set;
}

/** Ambitos de un permiso concedido. */
export type ScopeType = 'GLOBAL' | 'ORGANIZATION' | 'CLUB' | 'CAMPAIGN';

export interface RoleAssignment {
  role: Role;
  scopeType: ScopeType;
  /** null cuando scopeType === 'GLOBAL' */
  scopeId: string | null;
}

export interface AccessCheck {
  permission: Permission;
  /** Recurso sobre el que se actua, si aplica. */
  scopeType?: ScopeType;
  scopeId?: string | null;
}

/**
 * Evalua si un conjunto de asignaciones satisface una comprobacion de acceso.
 * Un rol GLOBAL cubre cualquier ambito; un rol con ambito solo cubre su propio id.
 */
export function hasAccess(assignments: readonly RoleAssignment[], check: AccessCheck): boolean {
  return assignments.some((assignment) => {
    if (!roleHasPermission(assignment.role, check.permission)) return false;
    if (assignment.scopeType === 'GLOBAL') return true;
    if (!check.scopeType || check.scopeId == null) return false;
    return assignment.scopeType === check.scopeType && assignment.scopeId === check.scopeId;
  });
}

/**
 * Permisos que jamas deben concederse a un rol externo, cualquiera sea su
 * ambito. Se comprueba en las pruebas de autorizacion como red de seguridad
 * frente a un cambio accidental de la matriz.
 */
export const PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES: readonly Permission[] = [
  'fans:read',
  'ownership:read',
  'ownership:write',
  'chips:read',
  'chips:write',
  'privacy:read',
  'privacy:write',
  'users:write',
  'roles:assign',
];

export const EXTERNAL_ROLES: readonly Role[] = ['SPONSOR', 'CONTENT_AGENCY'];
