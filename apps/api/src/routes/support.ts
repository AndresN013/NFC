import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  canTransitionSupportCase,
  maskPublicRef,
  PRIVACY_REQUEST_STATES,
  PRIVACY_REQUEST_TYPES,
  SUPPORT_CASE_STATES,
  SUPPORT_CASE_TRANSITIONS,
  type SupportCaseState,
} from '@mev/domain';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { buildRequestContext } from '../lib/request-context.js';
import { ejecutarEliminacionDeDatos } from '../services/privacy-erasure.js';

/**
 * Cierre del circuito de soporte y privacidad.
 *
 * POR QUE ESTAS RUTAS EXISTEN
 * ---------------------------
 * El motor de riesgo devuelve `CONTACT_SUPPORT` como accion recomendada en todos
 * los veredictos problematicos. Sin estas rutas, ese consejo terminaba en un
 * caso que soporte podia LEER pero no tocar: ni asignar, ni responder, ni
 * cerrar. Y las solicitudes de privacidad tenian un plazo de atencion que era
 * inaplicable, porque no habia forma de marcarlas resueltas.
 *
 * PRINCIPIO DE MINIMIZACION APLICADO A SOPORTE
 * --------------------------------------------
 * Soporte necesita ver datos personales para hacer su trabajo, y eso es
 * legitimo. Lo que no es legitimo es que los vea sin dejar rastro. Cada consulta
 * de una ficha de aficionado queda auditada, y la ficha devuelve el minimo
 * necesario: nunca el hash de contrasena, nunca los tokens, nunca la ubicacion.
 */

export default async function supportRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;

  // --- Casos de soporte -----------------------------------------------------

  app.get(
    '/support-cases/:id',
    {
      preHandler: [app.requirePermission('support:read')],
      schema: { tags: ['admin'], summary: 'Detalle de un caso de soporte con sus notas' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const caso = await db.supportCase.findUnique({
        where: { id },
        include: {
          notes: {
            orderBy: { createdAt: 'asc' },
            include: { author: { select: { displayName: true } } },
          },
          assignee: { select: { id: true, displayName: true } },
          jerseyUnit: {
            select: {
              id: true,
              publicRef: true,
              state: true,
              jerseyModel: { select: { name: true, club: { select: { name: true } } } },
            },
          },
          fan: { select: { id: true, email: true, displayName: true } },
        },
      });

      if (!caso) throw notFound('Caso no encontrado');

      return {
        id: caso.id,
        reason: caso.reason,
        state: caso.state,
        subject: caso.subject,
        description: caso.description,
        contactEmail: caso.contactEmail,
        createdAt: caso.createdAt.toISOString(),
        resolvedAt: caso.resolvedAt?.toISOString() ?? null,
        assignee: caso.assignee,
        // Transiciones validas desde el estado actual: la interfaz ofrece solo
        // las posibles en lugar de intentar una y recibir un 409.
        allowedTransitions: SUPPORT_CASE_TRANSITIONS[caso.state as SupportCaseState] ?? [],
        unit: caso.jerseyUnit
          ? {
              id: caso.jerseyUnit.id,
              maskedRef: maskPublicRef(caso.jerseyUnit.publicRef),
              state: caso.jerseyUnit.state,
              model: caso.jerseyUnit.jerseyModel.name,
              club: caso.jerseyUnit.jerseyModel.club.name,
            }
          : null,
        fan: caso.fan ? { id: caso.fan.id, email: caso.fan.email } : null,
        notes: caso.notes.map((n) => ({
          id: n.id,
          body: n.body,
          visibleToCustomer: n.visibleToCustomer,
          author: n.author?.displayName ?? 'Sistema',
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  app.patch(
    '/support-cases/:id',
    {
      preHandler: [app.requirePermission('support:write')],
      schema: { tags: ['admin'], summary: 'Asigna o cambia el estado de un caso' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          state: z.enum(SUPPORT_CASE_STATES).optional(),
          // `null` explicito desasigna; ausente deja la asignacion como esta.
          assigneeId: z.string().uuid().nullish(),
        })
        .parse(request.body);

      if (body.state === undefined && body.assigneeId === undefined) {
        throw badRequest('Indique al menos un cambio: estado o responsable.');
      }

      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const caso = await db.supportCase.findUnique({ where: { id } });
      if (!caso) throw notFound('Caso no encontrado');

      if (body.state && body.state !== caso.state) {
        const permitidas = SUPPORT_CASE_TRANSITIONS[caso.state as SupportCaseState] ?? [];
        if (!canTransitionSupportCase(caso.state as SupportCaseState, body.state)) {
          throw conflict(
            `Un caso en estado ${caso.state} no puede pasar a ${body.state}.`,
            `transiciones validas: ${permitidas.join(', ') || 'ninguna'}`,
          );
        }
      }

      if (body.assigneeId) {
        // El responsable debe existir, estar activo y tener permiso de soporte.
        // Asignar un caso a alguien que no puede resolverlo lo deja huerfano.
        const destino = await db.user.findFirst({
          where: { id: body.assigneeId, active: true, deletedAt: null },
          include: { roleAssignments: true },
        });
        if (!destino) throw badRequest('El responsable indicado no existe o esta inactivo.');

        const puedeAtender = destino.roleAssignments.some((a) =>
          ['SUPPORT', 'MARATHON_ADMIN', 'SUPERADMIN'].includes(a.role),
        );
        if (!puedeAtender) {
          throw badRequest('El responsable indicado no tiene un rol que pueda atender casos.');
        }
      }

      const resuelto = body.state === 'RESOLVED' || body.state === 'CLOSED';

      const actualizado = await db.supportCase.update({
        where: { id },
        data: {
          ...(body.state ? { state: body.state } : {}),
          ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
          ...(resuelto && !caso.resolvedAt ? { resolvedAt: new Date() } : {}),
        },
        select: { id: true, state: true, assigneeId: true, resolvedAt: true },
      });

      await recordAudit(db, {
        actorId: actor.id,
        action: 'support.case.updated',
        entityType: 'SupportCase',
        entityId: id,
        metadata: { from: caso.state, to: actualizado.state, assigneeId: body.assigneeId },
        ipPrefix: context.ipPrefix,
      });

      return {
        ...actualizado,
        resolvedAt: actualizado.resolvedAt?.toISOString() ?? null,
        allowedTransitions: SUPPORT_CASE_TRANSITIONS[actualizado.state as SupportCaseState] ?? [],
      };
    },
  );

  app.post(
    '/support-cases/:id/notes',
    {
      preHandler: [app.requirePermission('support:write')],
      schema: { tags: ['admin'], summary: 'Anade una nota interna o una respuesta al cliente' },
    },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          body: z.string().min(2).max(4000),
          /**
           * Por defecto `false`: publicar hacia fuera es una decision explicita.
           * Una nota interna puede contener una hipotesis sobre una posible
           * falsificacion, y filtrarla seria acusar a un cliente sin fundamento.
           */
          visibleToCustomer: z.boolean().default(false),
        })
        .parse(request.body);

      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const caso = await db.supportCase.findUnique({ where: { id }, select: { state: true } });
      if (!caso) throw notFound('Caso no encontrado');
      if (caso.state === 'CLOSED') {
        throw conflict('Un caso cerrado no admite notas nuevas. Abra un caso nuevo.');
      }

      const nota = await db.supportCaseNote.create({
        data: {
          caseId: id,
          authorId: actor.id,
          body: body.body,
          visibleToCustomer: body.visibleToCustomer,
        },
        select: { id: true, createdAt: true },
      });

      // Responder al cliente implica que la bola pasa a su lado.
      if (body.visibleToCustomer && caso.state !== 'WAITING_CUSTOMER') {
        const permitidas = SUPPORT_CASE_TRANSITIONS[caso.state as SupportCaseState] ?? [];
        if (permitidas.includes('WAITING_CUSTOMER')) {
          await db.supportCase.update({ where: { id }, data: { state: 'WAITING_CUSTOMER' } });
        }
      }

      await recordAudit(db, {
        actorId: actor.id,
        action: body.visibleToCustomer ? 'support.case.replied' : 'support.case.noted',
        entityType: 'SupportCase',
        entityId: id,
        // El cuerpo de la nota NO se registra en auditoria: ya esta almacenado en
        // su tabla, y duplicarlo multiplicaria la superficie de exposicion.
        metadata: { noteId: nota.id, visibleToCustomer: body.visibleToCustomer },
        ipPrefix: context.ipPrefix,
      });

      return reply.status(201).send({
        id: nota.id,
        createdAt: nota.createdAt.toISOString(),
        visibleToCustomer: body.visibleToCustomer,
      });
    },
  );

  // --- Ficha de aficionado para soporte -------------------------------------

  app.get(
    '/fans/:id',
    {
      preHandler: [app.requirePermission('fans:read')],
      schema: { tags: ['admin'], summary: 'Ficha minima de un aficionado, para atender su caso' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const fan = await db.fanAccount.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          displayName: true,
          locale: true,
          loyaltyTier: true,
          active: true,
          createdAt: true,
          deletedAt: true,
          consents: { select: { purpose: true, granted: true, revokedAt: true } },
          ownerships: {
            where: { endedAt: null },
            select: {
              startedAt: true,
              acquiredVia: true,
              jerseyUnit: {
                select: {
                  id: true,
                  publicRef: true,
                  state: true,
                  jerseyModel: { select: { name: true } },
                },
              },
            },
          },
          _count: { select: { supportCases: true } },
        },
      });

      if (!fan) throw notFound('Aficionado no encontrado');

      // Toda consulta de una ficha personal deja rastro. Sin esto, una consulta
      // masiva de fichas seria indistinguible de la atencion legitima de casos.
      await recordAudit(db, {
        actorId: actor.id,
        action: 'support.fan.viewed',
        entityType: 'FanAccount',
        entityId: id,
        ipPrefix: context.ipPrefix,
      });

      return {
        id: fan.id,
        email: fan.email,
        displayName: fan.displayName,
        locale: fan.locale,
        loyaltyTier: fan.loyaltyTier,
        active: fan.active,
        anonymized: fan.deletedAt != null,
        createdAt: fan.createdAt.toISOString(),
        supportCaseCount: fan._count.supportCases,
        consents: fan.consents.map((c) => ({
          purpose: c.purpose,
          granted: c.granted && c.revokedAt == null,
        })),
        // Se muestra la referencia ENMASCARADA incluso a soporte: para atender un
        // caso basta reconocer la prenda, no necesita el identificador completo.
        jerseys: fan.ownerships.map((o) => ({
          unitId: o.jerseyUnit.id,
          maskedRef: maskPublicRef(o.jerseyUnit.publicRef),
          model: o.jerseyUnit.jerseyModel.name,
          state: o.jerseyUnit.state,
          acquiredVia: o.acquiredVia,
          since: o.startedAt.toISOString(),
        })),
      };
    },
  );

  // --- Titularidad asistida por soporte -------------------------------------

  app.get(
    '/units/:id/ownership',
    {
      preHandler: [app.requirePermission('ownership:read')],
      schema: { tags: ['admin'], summary: 'Titularidad actual e historial de una unidad' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const unit = await db.jerseyUnit.findUnique({
        where: { id },
        select: {
          publicRef: true,
          state: true,
          ownerships: {
            orderBy: { startedAt: 'asc' },
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              acquiredVia: true,
              fan: { select: { id: true, email: true } },
            },
          },
          transfers: {
            where: { state: 'PENDING' },
            select: { id: true, toEmail: true, expiresAt: true },
          },
        },
      });

      if (!unit) throw notFound('Unidad no encontrada');

      return {
        maskedRef: maskPublicRef(unit.publicRef),
        state: unit.state,
        current: unit.ownerships
          .filter((o) => o.endedAt == null)
          .map((o) => ({ ownershipId: o.id, fanId: o.fan.id, email: o.fan.email })),
        history: unit.ownerships.map((o) => ({
          ownershipId: o.id,
          fanId: o.fan.id,
          acquiredVia: o.acquiredVia,
          from: o.startedAt.toISOString(),
          to: o.endedAt?.toISOString() ?? null,
        })),
        pendingTransfers: unit.transfers.map((t) => ({
          id: t.id,
          toEmail: t.toEmail,
          expiresAt: t.expiresAt.toISOString(),
        })),
      };
    },
  );

  /**
   * Libera la titularidad de una unidad.
   *
   * Caso real que resuelve: alguien vende su jersey, pierde el acceso a su cuenta
   * y el comprador no puede reclamarlo porque la unidad ya tiene titular. Sin
   * esta operacion, la prenda queda bloqueada para siempre.
   *
   * Es la operacion mas propensa a abuso de todo el panel: permite despojar a
   * alguien de su titularidad. Por eso exige motivo obligatorio, queda auditada
   * con el titular afectado, y NO la puede ejecutar el operario de planta.
   */
  app.post(
    '/units/:id/ownership/release',
    {
      preHandler: [app.requirePermission('ownership:write')],
      schema: { tags: ['admin'], summary: 'Libera la titularidad de una unidad' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          reason: z.string().min(10).max(500),
          /** Caso de soporte que respalda la decision. */
          supportCaseId: z.string().uuid().optional(),
        })
        .parse(request.body);

      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const unit = await db.jerseyUnit.findUnique({
        where: { id },
        select: { id: true, state: true, publicRef: true },
      });
      if (!unit) throw notFound('Unidad no encontrada');
      if (unit.state === 'REVOKED') {
        throw forbidden('Una unidad revocada no tiene titularidad que liberar.');
      }

      const activas = await db.ownership.findMany({
        where: { jerseyUnitId: id, endedAt: null },
        select: { id: true, fanId: true },
      });
      if (activas.length === 0) throw conflict('Esta unidad no tiene titular activo.');

      const ahora = new Date();

      await db.$transaction(async (tx) => {
        await tx.ownership.updateMany({
          where: { jerseyUnitId: id, endedAt: null },
          data: { endedAt: ahora },
        });
        // Una transferencia pendiente de un titular que deja de serlo no tiene
        // sentido: se cancela para que nadie la acepte despues.
        await tx.ownershipTransfer.updateMany({
          where: { jerseyUnitId: id, state: 'PENDING' },
          data: { state: 'CANCELLED', cancelledAt: ahora },
        });
        await tx.jerseyUnit.update({ where: { id }, data: { condition: 'TRANSFERRED' } });

        await recordAudit(tx, {
          actorId: actor.id,
          action: 'ownership.released',
          entityType: 'JerseyUnit',
          entityId: id,
          metadata: {
            reason: body.reason,
            supportCaseId: body.supportCaseId ?? null,
            // Se registra a quien se le retiro, para que la decision sea revisable.
            affectedFanIds: activas.map((o) => o.fanId),
          },
          ipPrefix: context.ipPrefix,
        });
      });

      return {
        unitId: id,
        releasedOwnerships: activas.length,
        claimableAgain: true,
        message: 'Titularidad liberada. La prenda vuelve a poder reclamarse.',
      };
    },
  );

  // --- Solicitudes de privacidad --------------------------------------------

  app.get(
    '/privacy-requests/:id',
    {
      preHandler: [app.requirePermission('privacy:read')],
      schema: { tags: ['admin'], summary: 'Detalle de una solicitud de privacidad' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const solicitud = await db.privacyRequest.findUnique({
        where: { id },
        include: { fan: { select: { id: true, email: true, deletedAt: true } } },
      });
      if (!solicitud) throw notFound('Solicitud no encontrada');

      const vencida = solicitud.resolvedAt == null && solicitud.dueAt < new Date();

      return {
        id: solicitud.id,
        type: solicitud.type,
        state: solicitud.state,
        email: solicitud.email,
        details: solicitud.details,
        createdAt: solicitud.createdAt.toISOString(),
        dueAt: solicitud.dueAt.toISOString(),
        overdue: vencida,
        resolvedAt: solicitud.resolvedAt?.toISOString() ?? null,
        resolution: solicitud.resolution,
        deletionExecutedAt: solicitud.deletionExecutedAt?.toISOString() ?? null,
        // `hasAccount` decide si la eliminacion puede ejecutarse: sin cuenta
        // asociada no hay datos que anonimizar.
        hasAccount: solicitud.fan != null,
        accountAnonymized: solicitud.fan?.deletedAt != null,
      };
    },
  );

  app.patch(
    '/privacy-requests/:id',
    {
      preHandler: [app.requirePermission('privacy:write')],
      schema: { tags: ['admin'], summary: 'Avanza o resuelve una solicitud de privacidad' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          state: z.enum(PRIVACY_REQUEST_STATES),
          resolution: z.string().max(2000).optional(),
        })
        .parse(request.body);

      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const solicitud = await db.privacyRequest.findUnique({ where: { id } });
      if (!solicitud) throw notFound('Solicitud no encontrada');

      // Cerrar una solicitud sin explicar como se resolvio la vuelve inauditable:
      // dentro de un ano nadie podra demostrar QUE se hizo.
      const terminal = body.state === 'COMPLETED' || body.state === 'REJECTED';
      if (terminal && !body.resolution) {
        throw badRequest(
          'Para cerrar una solicitud hay que indicar como se resolvio. Es la prueba de que se atendio.',
        );
      }

      // Una eliminacion no puede marcarse COMPLETED sin haberse ejecutado: eso
      // seria declarar cumplido un derecho que sigue sin cumplirse.
      if (
        body.state === 'COMPLETED' &&
        solicitud.type === 'DELETION' &&
        solicitud.fanId != null &&
        solicitud.deletionExecutedAt == null
      ) {
        throw conflict(
          'Ejecute primero la eliminacion de datos. No se puede declarar completada una eliminacion que no se ha realizado.',
        );
      }

      const actualizada = await db.privacyRequest.update({
        where: { id },
        data: {
          state: body.state,
          resolution: body.resolution ?? solicitud.resolution,
          ...(terminal ? { resolvedAt: new Date(), resolvedById: actor.id } : {}),
        },
        select: { id: true, state: true, resolvedAt: true },
      });

      await recordAudit(db, {
        actorId: actor.id,
        action: 'privacy.request.updated',
        entityType: 'PrivacyRequest',
        entityId: id,
        metadata: { from: solicitud.state, to: body.state, type: solicitud.type },
        ipPrefix: context.ipPrefix,
      });

      return { ...actualizada, resolvedAt: actualizada.resolvedAt?.toISOString() ?? null };
    },
  );

  /**
   * Ejecuta la eliminacion de datos.
   *
   * Operacion IRREVERSIBLE. Ver services/privacy-erasure.ts para la resolucion
   * de la tension entre el derecho de eliminacion y la obligacion de conservar la
   * prueba del consentimiento.
   */
  app.post(
    '/privacy-requests/:id/execute-deletion',
    {
      preHandler: [app.requirePermission('privacy:write')],
      schema: { tags: ['admin'], summary: 'Ejecuta la eliminacion de datos (irreversible)' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      // El parseo se invoca por su EFECTO, no por su valor: `z.literal(true)`
      // lanza si falta la confirmacion. No es burocracia, es la unica barrera
      // contra ejecutar una anonimizacion irreversible con un clic accidental.
      z.object({ confirm: z.literal(true) }).parse(request.body);

      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const solicitud = await db.privacyRequest.findUnique({ where: { id } });
      if (!solicitud) throw notFound('Solicitud no encontrada');

      if (solicitud.type !== 'DELETION') {
        throw badRequest(
          `Esta solicitud es de tipo ${solicitud.type}, no de eliminacion. Resuelvala por la via correspondiente.`,
        );
      }
      if (solicitud.deletionExecutedAt) {
        throw conflict('La eliminacion de esta solicitud ya se ejecuto.');
      }
      if (!solicitud.fanId) {
        throw badRequest(
          'La solicitud no tiene una cuenta asociada, asi que no hay datos de cuenta que anonimizar. ' +
            'Resuelvala indicando en la resolucion que no existia informacion vinculada a ese correo.',
        );
      }

      const resultado = await ejecutarEliminacionDeDatos(db, {
        fanId: solicitud.fanId,
        actorId: actor.id,
        privacyRequestId: id,
        ipPrefix: context.ipPrefix,
      });

      return {
        ...resultado,
        method: 'anonimizacion_irreversible',
        message:
          'Datos identificativos destruidos. Se conservaron las filas de consentimiento y canje ' +
          'como prueba, ya sin vinculo con una persona identificable.',
      };
    },
  );

  /** Tipos de solicitud, para que la interfaz no los reescriba. */
  app.get(
    '/privacy-requests/catalog',
    {
      preHandler: [app.requirePermission('privacy:read')],
      schema: { tags: ['admin'], summary: 'Tipos y estados de solicitud de privacidad' },
    },
    async () => ({ types: PRIVACY_REQUEST_TYPES, states: PRIVACY_REQUEST_STATES }),
  );
}

