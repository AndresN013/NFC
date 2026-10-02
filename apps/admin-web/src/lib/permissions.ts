/**
 * Guardia de permisos de la INTERFAZ.
 *
 * ============================================================================
 * ESTO NO ES CONTROL DE ACCESO.
 * ============================================================================
 * Todo lo que hay aqui sirve unicamente para no ensenar botones y secciones que
 * el usuario no puede usar. La autorizacion real la aplica el servidor: cada
 * ruta de `apps/api/src/routes/admin.ts` declara su permiso y lo comprueba en
 * `app.requirePermission` contra la sesion, sin mirar lo que diga el cliente.
 *
 * Consecuencia practica: si alguien manipula esta lista en su navegador, lo
 * unico que consigue es ver un enlace que al pulsarlo devuelve 403. Por eso las
 * paginas muestran el error de la API en vez de asumir que no puede ocurrir.
 */

import { permissionsForRoles, type Permission } from '@mev/domain/browser';
import type { RoleAssignmentDto } from './types';

/** Conveniencia de interfaz: el usuario tiene el permiso indicado. */
export function hasUiPermission(
  granted: readonly Permission[] | undefined,
  required: Permission,
): boolean {
  return granted?.includes(required) ?? false;
}

/** Conveniencia de interfaz: tiene TODOS los permisos indicados. */
export function hasAllUiPermissions(
  granted: readonly Permission[] | undefined,
  required: readonly Permission[],
): boolean {
  return required.every((permission) => hasUiPermission(granted, permission));
}

/** Conveniencia de interfaz: tiene AL MENOS UNO de los permisos indicados. */
export function hasAnyUiPermission(
  granted: readonly Permission[] | undefined,
  required: readonly Permission[],
): boolean {
  return required.some((permission) => hasUiPermission(granted, permission));
}

/**
 * Deriva los permisos de las asignaciones de rol que devuelve el login.
 *
 * Se usa como respaldo cuando `GET /admin/me` no esta disponible para ese rol.
 * Caso real: `/admin/me` exige `catalog:read`, que un SPONSOR no tiene, asi que
 * un patrocinador recibe 403 al pedir su propio perfil. Sin este respaldo su
 * menu quedaria vacio y no podria ni llegar a su campana.
 *
 * Al ser un calculo del cliente, vale todavia menos que la lista del servidor:
 * es exclusivamente para pintar el menu.
 */
export function uiPermissionsFromAssignments(
  assignments: readonly RoleAssignmentDto[],
): Permission[] {
  return [...permissionsForRoles(assignments.map((assignment) => assignment.role))];
}

/** Campanas sobre las que el usuario tiene alcance, para enlazar su vista. */
export function scopedCampaignIds(assignments: readonly RoleAssignmentDto[]): string[] {
  return assignments
    .filter((assignment) => assignment.scopeType === 'CAMPAIGN' && assignment.scopeId)
    .map((assignment) => assignment.scopeId as string);
}
