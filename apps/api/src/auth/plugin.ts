import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasAccess, roleHasPermission, type Permission, type ScopeType } from '@mev/domain';
import { forbidden, unauthorized } from '../lib/errors.js';
import {
  resolveFanSession,
  resolveUserSession,
  type AuthenticatedFan,
  type AuthenticatedUser,
} from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario interno autenticado, si la peticion trae sesion de panel/app. */
    currentUser?: AuthenticatedUser;
    /** Aficionado autenticado, si la peticion trae sesion de la web publica. */
    currentFan?: AuthenticatedFan;
  }
  interface FastifyInstance {
    /** Exige sesion de personal interno y un permiso concreto. */
    requirePermission(
      permission: Permission,
      scope?: { type: ScopeType; id: string | null },
    ): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Puerta DEBIL: exige el permiso en cualquier ambito, sin comprobar cual.
     *
     * Usela solo cuando el ambito depende de un parametro de la ruta y el
     * manejador comprueba el ambito exacto por su cuenta. El manejador que la
     * use ESTA OBLIGADO a llamar a `hasAccess` con el ambito concreto; si no lo
     * hace, un usuario con alcance sobre un recurso podria leer otro.
     */
    requirePermissionInAnyScope(
      permission: Permission,
    ): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Exige sesion valida de personal interno y NINGUN permiso concreto.
     *
     * Para las rutas que todo usuario autenticado necesita con independencia de
     * su rol: consultar su propio perfil y cerrar su propia sesion. Exigir un
     * permiso de catalogo en estas rutas dejaba a un patrocinador sin poder
     * cerrar sesion, porque su rol no incluye ese permiso.
     */
    requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** Exige sesion de aficionado. */
    requireFan(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** Carga el aficionado si hay sesion, sin exigirla. */
    optionalFan(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

export default fp(async function authPlugin(app: FastifyInstance) {
  const pepper = app.config.TOKEN_HASH_PEPPER;

  app.decorate(
    'requirePermission',
    (permission: Permission, scope?: { type: ScopeType; id: string | null }) => {
      return async (request: FastifyRequest): Promise<void> => {
        const token = extractBearer(request);
        if (!token) throw unauthorized('Se requiere autenticacion');

        const user = await resolveUserSession(app.db, token, pepper);
        request.currentUser = user;

        const granted = hasAccess(user.assignments, {
          permission,
          ...(scope ? { scopeType: scope.type, scopeId: scope.id } : {}),
        });

        if (!granted) {
          // El detalle interno queda en el registro; el cliente solo ve 403.
          throw forbidden(
            'No tiene permiso para esta operacion',
            `usuario ${user.id} carece de ${permission}`,
          );
        }
      };
    },
  );

  app.decorate('requirePermissionInAnyScope', (permission: Permission) => {
    return async (request: FastifyRequest): Promise<void> => {
      const token = extractBearer(request);
      if (!token) throw unauthorized('Se requiere autenticacion');

      const user = await resolveUserSession(app.db, token, pepper);
      request.currentUser = user;

      // Basta con que ALGUN rol asignado conceda el permiso. El ambito concreto
      // lo comprueba el manejador con el identificador de la ruta.
      const granted = user.assignments.some((assignment) =>
        roleHasPermission(assignment.role, permission),
      );

      if (!granted) {
        throw forbidden(
          'No tiene permiso para esta operacion',
          `usuario ${user.id} carece de ${permission} en cualquier ambito`,
        );
      }
    };
  });

  app.decorate('requireUser', async (request: FastifyRequest): Promise<void> => {
    const token = extractBearer(request);
    if (!token) throw unauthorized('Se requiere autenticacion');
    request.currentUser = await resolveUserSession(app.db, token, pepper);
  });

  app.decorate('requireFan', async (request: FastifyRequest): Promise<void> => {
    const token = extractBearer(request);
    if (!token) throw unauthorized('Se requiere iniciar sesion');
    request.currentFan = await resolveFanSession(app.db, token, pepper);
  });

  app.decorate('optionalFan', async (request: FastifyRequest): Promise<void> => {
    const token = extractBearer(request);
    if (!token) return;
    try {
      request.currentFan = await resolveFanSession(app.db, token, pepper);
    } catch {
      // Sesion invalida en una ruta opcional: se continua como anonimo.
      // Verificar un jersey nunca debe fallar porque caduco una sesion.
      request.currentFan = undefined;
    }
  });
});
