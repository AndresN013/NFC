import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  maskChipUid,
  MIN_AGGREGATE_COHORT_SIZE,
  PERMISSIONS,
  ROLES,
  suppressSmallCohort,
  hasAccess,
  type Permission,
} from '@mev/domain';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { burnTime, hashPassword, validatePasswordStrength, verifyPassword } from '../lib/passwords.js';
import { createUserSession, revokeAllUserSessions, revokeUserSession } from '../auth/sessions.js';
import { recordAudit } from '../lib/audit.js';
import { buildRequestContext } from '../lib/request-context.js';

/**
 * Panel administrativo.
 *
 * Cada ruta declara el permiso que exige. La comprobacion vive en
 * `app.requirePermission`, que resuelve la sesion y evalua la matriz de roles
 * del dominio. Ninguna ruta confia en el rol que diga el cliente.
 */

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().max(200).optional(),
});

function paginate(input: { page: number; pageSize: number }) {
  return { skip: (input.page - 1) * input.pageSize, take: input.pageSize };
}

/**
 * Techo de filas de una exportacion CSV.
 * Las respuestas indican si el fichero quedo truncado: una exportacion
 * silenciosamente incompleta se lee como "esto es todo" cuando no lo es.
 */
const CSV_EXPORT_LIMIT = 5000;

/** Serializa filas a CSV escapando comillas y separadores. */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (value: unknown): string => {
    const text = value == null ? '' : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
}

/**
 * Envia filas como CSV.
 *
 * `truncated` indica si el fichero quedo recortado por el techo de exportacion.
 * Se emite como cabecera ANTES de `send`: una cabecera anadida despues de enviar
 * el cuerpo no llega al cliente, y el consumidor interpretaria un fichero
 * incompleto como completo.
 */
function sendCsv(
  reply: FastifyReply,
  filename: string,
  rows: Record<string, unknown>[],
  truncated = false,
) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .header('x-export-truncated', String(truncated))
    .send(toCsv(rows));
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;

  // --- Sesion ---------------------------------------------------------------

  app.post(
    '/login',
    {
      config: { rateLimit: { max: config.RATE_LIMIT_LOGIN_PER_MINUTE, timeWindow: '1 minute' } },
      schema: { tags: ['admin'], summary: 'Inicia sesion en el panel' },
    },
    async (request) => {
      const body = z
        .object({ email: z.string().email().max(320), password: z.string().max(200) })
        .parse(request.body);
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const user = await db.user.findUnique({
        where: { email: body.email.toLowerCase() },
        include: { roleAssignments: true },
      });

      if (!user || !user.active || user.deletedAt) {
        await burnTime(body.password);
        throw unauthorized('Correo o contrasena incorrectos');
      }
      if (!(await verifyPassword(user.passwordHash, body.password))) {
        await recordAudit(db, {
          actorId: user.id,
          action: 'admin.login.failed',
          entityType: 'User',
          entityId: user.id,
          ipPrefix: context.ipPrefix,
        });
        throw unauthorized('Correo o contrasena incorrectos');
      }

      // MFA preparado para fase 2: hoy se registra la intencion pero no se exige
      // un segundo factor. Ver docs/limitaciones.md
      const session = await createUserSession(db, {
        userId: user.id,
        ipPrefix: context.ipPrefix,
        pepper: config.TOKEN_HASH_PEPPER,
      });

      await Promise.all([
        db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        recordAudit(db, {
          actorId: user.id,
          action: 'admin.login',
          entityType: 'User',
          entityId: user.id,
          ipPrefix: context.ipPrefix,
        }),
      ]);

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          mfaEnabled: user.mfaEnabled,
          roles: user.roleAssignments.map((a) => ({
            role: a.role,
            scopeType: a.scopeType,
            scopeId: a.scopeId,
          })),
        },
      };
    },
  );

  app.post(
    '/logout',
    // Sin permiso concreto: todo usuario debe poder cerrar SU sesion. Exigir
    // `catalog:read` dejaba a un patrocinador sin forma de cerrarla.
    { preHandler: [app.requireUser], schema: { tags: ['admin'] } },
    async (request) => {
      await revokeUserSession(db, request.currentUser!.sessionId);
      return { ok: true };
    },
  );

  app.get(
    '/me',
    // Consultar el propio perfil no depende del rol: es lo que permite a la
    // interfaz saber QUE puede mostrar.
    { preHandler: [app.requireUser], schema: { tags: ['admin'] } },
    async (request) => {
      const user = request.currentUser!;
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.assignments,
        // La interfaz usa esto para ocultar secciones que el usuario no puede ver.
        permissions: ALL_UI_PERMISSIONS.filter((p) => hasAccess(user.assignments, { permission: p })),
      };
    },
  );

  // --- Usuarios y roles -----------------------------------------------------

  app.get(
    '/users',
    { preHandler: [app.requirePermission('users:read')], schema: { tags: ['admin'] } },
    async (request) => {
      const query = pagination.parse(request.query);
      const where = {
        deletedAt: null,
        ...(query.q
          ? {
              OR: [
                { email: { contains: query.q, mode: 'insensitive' as const } },
                { displayName: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [total, users] = await Promise.all([
        db.user.count({ where }),
        db.user.findMany({
          where,
          ...paginate(query),
          orderBy: { createdAt: 'desc' },
          include: { roleAssignments: true },
        }),
      ]);

      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        // Nunca se devuelve `passwordHash` ni `mfaSecretRef`.
        items: users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          active: u.active,
          mfaEnabled: u.mfaEnabled,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          roles: u.roleAssignments.map((a) => ({
            role: a.role,
            scopeType: a.scopeType,
            scopeId: a.scopeId,
          })),
        })),
      };
    },
  );

  app.post(
    '/users',
    { preHandler: [app.requirePermission('users:write')], schema: { tags: ['admin'] } },
    async (request, reply) => {
      const body = z
        .object({
          email: z.string().email().max(320),
          displayName: z.string().min(2).max(120),
          password: z.string().max(200),
          roles: z
            .array(
              z.object({
                role: z.enum(ROLES),
                scopeType: z.enum(['GLOBAL', 'ORGANIZATION', 'CLUB', 'CAMPAIGN']).default('GLOBAL'),
                scopeId: z.string().uuid().nullish(),
              }),
            )
            .min(1),
        })
        .parse(request.body);

      const strength = validatePasswordStrength(body.password);
      if (!strength.ok) throw badRequest(strength.reason!);

      const actor = request.currentUser!;

      // Solo un SUPERADMIN crea otro SUPERADMIN: impide la escalada de un
      // MARATHON_ADMIN que tiene `users:write`.
      const grantsSuperadmin = body.roles.some((r) => r.role === 'SUPERADMIN');
      const actorIsSuperadmin = actor.assignments.some((a) => a.role === 'SUPERADMIN');
      if (grantsSuperadmin && !actorIsSuperadmin) {
        throw forbidden('Solo un superadministrador puede crear otro superadministrador.');
      }

      // Un rol con alcance debe traer su ambito, o seria un rol global encubierto.
      for (const role of body.roles) {
        if (role.scopeType !== 'GLOBAL' && !role.scopeId) {
          throw badRequest(`El rol ${role.role} con alcance ${role.scopeType} requiere un scopeId.`);
        }
      }

      const created = await db.user.create({
        data: {
          email: body.email.toLowerCase(),
          displayName: body.displayName,
          passwordHash: await hashPassword(body.password),
          roleAssignments: {
            create: body.roles.map((r) => ({
              role: r.role,
              scopeType: r.scopeType,
              scopeId: r.scopeId ?? null,
            })),
          },
        },
        select: { id: true, email: true, displayName: true },
      });

      await recordAudit(db, {
        actorId: actor.id,
        action: 'admin.user.created',
        entityType: 'User',
        entityId: created.id,
        metadata: { roles: body.roles.map((r) => r.role) },
      });

      return reply.status(201).send(created);
    },
  );

  app.patch(
    '/users/:id/active',
    { preHandler: [app.requirePermission('users:write')], schema: { tags: ['admin'] } },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ active: z.boolean() }).parse(request.body);
      const actor = request.currentUser!;

      if (id === actor.id && !body.active) {
        throw badRequest('No puede desactivar su propia cuenta.');
      }

      await db.user.update({ where: { id }, data: { active: body.active } });

      // Desactivar debe cortar el acceso AHORA, no cuando caduque la sesion.
      const revoked = body.active ? 0 : await revokeAllUserSessions(db, id);

      await recordAudit(db, {
        actorId: actor.id,
        action: body.active ? 'admin.user.activated' : 'admin.user.deactivated',
        entityType: 'User',
        entityId: id,
        metadata: { sessionsRevoked: revoked },
      });

      return { ok: true, sessionsRevoked: revoked };
    },
  );

  // --- Catalogo -------------------------------------------------------------

  app.get(
    '/clubs',
    { preHandler: [app.requirePermission('catalog:read')], schema: { tags: ['admin'] } },
    async () => {
      const clubs = await db.club.findMany({
        where: { deletedAt: null },
        include: {
          seasons: { select: { id: true, name: true, startDate: true, endDate: true } },
          _count: { select: { jerseyModels: true, players: true } },
        },
        orderBy: { name: 'asc' },
      });
      return { items: clubs };
    },
  );

  app.get(
    '/jersey-models',
    { preHandler: [app.requirePermission('catalog:read')], schema: { tags: ['admin'] } },
    async () => {
      const models = await db.jerseyModel.findMany({
        where: { deletedAt: null },
        include: {
          club: { select: { name: true, slug: true } },
          season: { select: { name: true } },
          skus: true,
          _count: { select: { units: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return { items: models };
    },
  );

  app.get(
    '/players',
    { preHandler: [app.requirePermission('catalog:read')], schema: { tags: ['admin'] } },
    async (request) => {
      const query = z.object({ clubId: z.string().uuid().optional() }).parse(request.query);
      const players = await db.player.findMany({
        where: { active: true, ...(query.clubId ? { clubId: query.clubId } : {}) },
        orderBy: { shirtNumber: 'asc' },
      });
      return { items: players };
    },
  );

  // --- Unidades -------------------------------------------------------------

  app.get(
    '/units',
    { preHandler: [app.requirePermission('production:read')], schema: { tags: ['admin'] } },
    async (request, reply) => {
      const query = pagination
        .extend({
          state: z.string().optional(),
          clubId: z.string().uuid().optional(),
          orderId: z.string().uuid().optional(),
          format: z.enum(['json', 'csv']).default('json'),
        })
        .parse(request.query);

      const where = {
        deletedAt: null,
        ...(query.state ? { state: query.state as never } : {}),
        ...(query.orderId ? { productionOrderId: query.orderId } : {}),
        ...(query.clubId ? { jerseyModel: { clubId: query.clubId } } : {}),
        ...(query.q ? { publicRef: { contains: query.q.toUpperCase() } } : {}),
      };

      const canSeeChipUid = hasAccess(request.currentUser!.assignments, {
        permission: 'chips:read',
      });

      // La exportacion CSV tiene un techo explicito de filas. Si se alcanza,
      // el fichero esta truncado y quien lo pidio debe saberlo.
      const window =
        query.format === 'csv' ? { skip: 0, take: CSV_EXPORT_LIMIT } : paginate(query);

      const [total, units] = await Promise.all([
        db.jerseyUnit.count({ where }),
        db.jerseyUnit.findMany({
          where,
          ...window,
          orderBy: { createdAt: 'desc' },
          include: {
            jerseyModel: { include: { club: true, season: true } },
            sku: true,
            emblem: { include: { chip: true } },
            ownerships: { where: { endedAt: null }, select: { id: true } },
          },
        }),
      ]);

      const rows = units.map((u) => ({
        // Identificador de la unidad: lo exigen `POST /units/:id/revoke` y las
        // demas acciones. No es secreto (la web publica ya lo devuelve como
        // `unitHandle`); lo secreto es el token del chip, que jamas sale.
        id: u.id,
        publicRef: u.publicRef,
        state: u.state,
        condition: u.condition,
        club: u.jerseyModel.club.name,
        season: u.jerseyModel.season.name,
        model: u.jerseyModel.name,
        edition: u.jerseyModel.edition,
        sku: u.sku?.code ?? '',
        size: u.sku?.size ?? '',
        chipType: u.emblem?.chip?.chipType ?? '',
        chipState: u.emblem?.chip?.state ?? '',
        // El UID completo exige `chips:read`. Sin ese permiso va enmascarado.
        chipUid: u.emblem?.chip
          ? canSeeChipUid
            ? u.emblem.chip.uid
            : maskChipUid(u.emblem.chip.uid)
          : '',
        hasOwner: u.ownerships.length > 0 ? 'si' : 'no',
        interactions: u.interactionCount,
        activatedAt: u.activatedAt?.toISOString() ?? '',
      }));

      if (query.format === 'csv') {
        await recordAudit(db, {
          actorId: request.currentUser!.id,
          action: 'admin.units.exported',
          entityType: 'JerseyUnit',
          metadata: {
            rows: rows.length,
            totalMatching: total,
            truncated: total > rows.length,
            includedChipUid: canSeeChipUid,
          },
        });
        return sendCsv(reply, 'unidades.csv', rows, total > rows.length);
      }

      return { total, page: query.page, pageSize: query.pageSize, items: rows };
    },
  );

  app.post(
    '/units/:id/revoke',
    { preHandler: [app.requirePermission('production:revoke')], schema: { tags: ['admin'] } },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ reason: z.string().min(5).max(500) }).parse(request.body);
      const actor = request.currentUser!;

      const unit = await db.jerseyUnit.findUnique({
        where: { id },
        include: { emblem: { include: { chip: true } }, certificate: true },
      });
      if (!unit) throw notFound('Unidad no encontrada');

      const now = new Date();

      await db.$transaction(async (tx) => {
        await tx.jerseyUnit.update({
          where: { id },
          data: { state: 'REVOKED', revokedAt: now, revokeReason: body.reason },
        });
        if (unit.emblem?.chip) {
          await tx.nfcChip.update({
            where: { id: unit.emblem.chip.id },
            data: { state: 'REVOKED', revokedAt: now, revokeReason: body.reason },
          });
        }
        if (unit.certificate) {
          await tx.digitalCertificate.update({
            where: { id: unit.certificate.id },
            data: { revokedAt: now },
          });
        }
        // La revocacion corta tambien la titularidad: la prenda deja de contar
        // como propiedad activa de nadie.
        await tx.ownership.updateMany({
          where: { jerseyUnitId: id, endedAt: null },
          data: { endedAt: now },
        });
        await recordAudit(tx, {
          actorId: actor.id,
          action: 'admin.unit.revoked',
          entityType: 'JerseyUnit',
          entityId: id,
          metadata: { reason: body.reason },
        });
      });

      return { ok: true, unitId: id, state: 'REVOKED' };
    },
  );

  // --- Chips y lotes --------------------------------------------------------

  app.get(
    '/chips',
    { preHandler: [app.requirePermission('chips:read')], schema: { tags: ['admin'] } },
    async (request) => {
      const query = pagination.extend({ state: z.string().optional() }).parse(request.query);
      const where = query.state ? { state: query.state as never } : {};

      const [total, chips] = await Promise.all([
        db.nfcChip.count({ where }),
        db.nfcChip.findMany({
          where,
          ...paginate(query),
          orderBy: { createdAt: 'desc' },
          include: { batch: { select: { code: true, flagged: true } } },
        }),
      ]);

      // Esta ruta revela UID completos, que son dato sensible. Se audita el
      // acceso igual que la exportacion CSV: sin rastro, una consulta masiva de
      // UID seria indistinguible de un uso legitimo.
      await recordAudit(db, {
        actorId: request.currentUser!.id,
        action: 'admin.chips.listed',
        entityType: 'NfcChip',
        metadata: { rows: chips.length, stateFilter: query.state ?? null },
      });

      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: chips.map((c) => ({
          id: c.id,
          uid: c.uid,
          chipType: c.chipType,
          state: c.state,
          batch: c.batch?.code ?? null,
          batchFlagged: c.batch?.flagged ?? false,
          lastAcceptedCounter: c.lastAcceptedCounter,
          programmedAt: c.programmedAt?.toISOString() ?? null,
          activatedAt: c.activatedAt?.toISOString() ?? null,
          // El hash del token NUNCA se devuelve, ni siquiera a un superadmin:
          // no aporta nada operativo y su filtracion permitiria correlacionar.
        })),
      };
    },
  );

  app.get(
    '/batches',
    { preHandler: [app.requirePermission('production:read')], schema: { tags: ['admin'] } },
    async () => {
      const batches = await db.productionBatch.findMany({
        include: { _count: { select: { chips: true, emblems: true } } },
        orderBy: { receivedAt: 'desc' },
      });
      return { items: batches };
    },
  );

  app.get(
    '/orders',
    { preHandler: [app.requirePermission('production:read')], schema: { tags: ['admin'] } },
    async () => {
      const orders = await db.productionOrder.findMany({
        include: { _count: { select: { units: true, jobs: true } }, batches: true },
        orderBy: { createdAt: 'desc' },
      });
      return { items: orders };
    },
  );

  app.post(
    '/orders',
    { preHandler: [app.requirePermission('production:write')], schema: { tags: ['admin'] } },
    async (request, reply) => {
      const body = z
        .object({
          organizationId: z.string().uuid(),
          code: z.string().min(3).max(60),
          plannedUnits: z.number().int().min(1).max(1_000_000),
          notes: z.string().max(1000).optional(),
        })
        .parse(request.body);

      const order = await db.productionOrder.create({
        data: { ...body, state: 'OPEN' },
        select: { id: true, code: true, state: true, plannedUnits: true },
      });

      await recordAudit(db, {
        actorId: request.currentUser!.id,
        action: 'admin.order.created',
        entityType: 'ProductionOrder',
        entityId: order.id,
        metadata: { code: order.code },
      });

      return reply.status(201).send(order);
    },
  );

  // --- Dispositivos ---------------------------------------------------------

  app.get(
    '/devices',
    { preHandler: [app.requirePermission('devices:read')], schema: { tags: ['admin'] } },
    async () => {
      const devices = await db.authorizedDevice.findMany({
        include: { station: true, primaryOperator: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return {
        items: devices.map((d) => ({
          id: d.id,
          deviceId: d.deviceId,
          label: d.label,
          model: d.model,
          osVersion: d.osVersion,
          active: d.active,
          station: d.station?.name ?? null,
          operator: d.primaryOperator?.displayName ?? null,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          // Attestation preparada para fase 2; hoy nunca esta verificada.
          attestationVerified: false,
        })),
      };
    },
  );

  app.post(
    '/devices',
    { preHandler: [app.requirePermission('devices:write')], schema: { tags: ['admin'] } },
    async (request, reply) => {
      const body = z
        .object({
          deviceId: z.string().min(8).max(200),
          label: z.string().min(2).max(120),
          model: z.string().max(120).optional(),
          osVersion: z.string().max(60).optional(),
          stationId: z.string().uuid().optional(),
        })
        .parse(request.body);

      const device = await db.authorizedDevice.create({
        data: { ...body, stationId: body.stationId ?? null },
        select: { id: true, deviceId: true, label: true, active: true },
      });

      await recordAudit(db, {
        actorId: request.currentUser!.id,
        action: 'admin.device.authorized',
        entityType: 'AuthorizedDevice',
        entityId: device.id,
        metadata: { label: body.label },
      });

      return reply.status(201).send(device);
    },
  );

  app.patch(
    '/devices/:id/active',
    { preHandler: [app.requirePermission('devices:write')], schema: { tags: ['admin'] } },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ active: z.boolean() }).parse(request.body);

      await db.authorizedDevice.update({ where: { id }, data: { active: body.active } });

      // Desautorizar un telefono revoca sus sesiones de inmediato.
      const revoked = body.active
        ? 0
        : (
            await db.userSession.updateMany({
              where: { deviceId: id, revokedAt: null },
              data: { revokedAt: new Date() },
            })
          ).count;

      await recordAudit(db, {
        actorId: request.currentUser!.id,
        action: body.active ? 'admin.device.enabled' : 'admin.device.disabled',
        entityType: 'AuthorizedDevice',
        entityId: id,
        metadata: { sessionsRevoked: revoked },
      });

      return { ok: true, sessionsRevoked: revoked };
    },
  );

  // --- Alertas de riesgo ----------------------------------------------------

  app.get(
    '/alerts',
    { preHandler: [app.requirePermission('alerts:read')], schema: { tags: ['admin'] } },
    async (request) => {
      const query = pagination
        .extend({ state: z.string().optional(), riskLevel: z.string().optional() })
        .parse(request.query);

      const where = {
        ...(query.state ? { state: query.state as never } : {}),
        ...(query.riskLevel ? { riskLevel: query.riskLevel as never } : {}),
      };

      const [total, alerts] = await Promise.all([
        db.riskAlert.count({ where }),
        db.riskAlert.findMany({
          where,
          ...paginate(query),
          orderBy: [{ riskLevel: 'desc' }, { createdAt: 'desc' }],
          include: {
            jerseyUnit: { select: { publicRef: true, state: true } },
            verificationEvent: {
              select: { method: true, trustLevel: true, countryCode: true, createdAt: true },
            },
          },
        }),
      ]);

      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: alerts.map((a) => ({
          id: a.id,
          state: a.state,
          riskLevel: a.riskLevel,
          reasonCodes: a.reasonCodes.split(',').filter(Boolean),
          summary: a.summary,
          unitRef: a.jerseyUnit?.publicRef ?? null,
          unitState: a.jerseyUnit?.state ?? null,
          method: a.verificationEvent?.method ?? null,
          trustLevel: a.verificationEvent?.trustLevel ?? null,
          countryCode: a.verificationEvent?.countryCode ?? null,
          createdAt: a.createdAt.toISOString(),
          reviewedAt: a.reviewedAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.patch(
    '/alerts/:id',
    { preHandler: [app.requirePermission('alerts:write')], schema: { tags: ['admin'] } },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          state: z.enum(['OPEN', 'IN_REVIEW', 'CONFIRMED', 'DISMISSED']),
          reviewNotes: z.string().max(2000).optional(),
        })
        .parse(request.body);

      const actor = request.currentUser!;

      await db.riskAlert.update({
        where: { id },
        data: {
          state: body.state,
          reviewNotes: body.reviewNotes ?? null,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      });

      await recordAudit(db, {
        actorId: actor.id,
        action: 'admin.alert.reviewed',
        entityType: 'RiskAlert',
        entityId: id,
        metadata: { state: body.state },
      });

      return { ok: true };
    },
  );

  // --- Soporte y privacidad -------------------------------------------------

  app.get(
    '/support-cases',
    { preHandler: [app.requirePermission('support:read')], schema: { tags: ['admin'] } },
    async (request) => {
      const query = pagination.extend({ state: z.string().optional() }).parse(request.query);
      const where = query.state ? { state: query.state as never } : {};

      const [total, cases] = await Promise.all([
        db.supportCase.count({ where }),
        db.supportCase.findMany({
          where,
          ...paginate(query),
          orderBy: { createdAt: 'desc' },
          include: { jerseyUnit: { select: { publicRef: true } } },
        }),
      ]);

      return { total, page: query.page, pageSize: query.pageSize, items: cases };
    },
  );

  app.get(
    '/privacy-requests',
    { preHandler: [app.requirePermission('privacy:read')], schema: { tags: ['admin'] } },
    async (request) => {
      const query = pagination.extend({ state: z.string().optional() }).parse(request.query);
      const where = query.state ? { state: query.state as never } : {};

      const [total, items] = await Promise.all([
        db.privacyRequest.count({ where }),
        db.privacyRequest.findMany({ where, ...paginate(query), orderBy: { dueAt: 'asc' } }),
      ]);

      return { total, page: query.page, pageSize: query.pageSize, items };
    },
  );

  // --- Contenido ------------------------------------------------------------

  app.get(
    '/content',
    { preHandler: [app.requirePermission('content:read')], schema: { tags: ['admin'] } },
    async () => {
      const items = await db.contentItem.findMany({
        where: { deletedAt: null },
        include: { rules: true, club: { select: { name: true } } },
        orderBy: { priority: 'desc' },
      });
      return { items };
    },
  );

  // --- Auditoria ------------------------------------------------------------

  app.get(
    '/audit',
    { preHandler: [app.requirePermission('audit:read')], schema: { tags: ['admin'] } },
    async (request, reply) => {
      const query = pagination
        .extend({
          action: z.string().max(100).optional(),
          entityType: z.string().max(60).optional(),
          format: z.enum(['json', 'csv']).default('json'),
        })
        .parse(request.query);

      const where = {
        ...(query.action ? { action: { contains: query.action } } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
      };

      const window =
        query.format === 'csv' ? { skip: 0, take: CSV_EXPORT_LIMIT } : paginate(query);

      const [total, events] = await Promise.all([
        db.auditEvent.count({ where }),
        db.auditEvent.findMany({
          where,
          ...window,
          orderBy: { createdAt: 'desc' },
          include: { actor: { select: { email: true, displayName: true } } },
        }),
      ]);

      const rows = events.map((e) => ({
        createdAt: e.createdAt.toISOString(),
        actor: e.actor?.email ?? e.actorType,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? '',
        ipPrefix: e.ipPrefix ?? '',
        metadata: JSON.stringify(e.metadata ?? {}),
      }));

      if (query.format === 'csv') {
        return sendCsv(reply, 'auditoria.csv', rows, total > rows.length);
      }
      return { total, page: query.page, pageSize: query.pageSize, items: rows };
    },
  );

  // --- Analitica ------------------------------------------------------------

  app.get(
    '/analytics/overview',
    { preHandler: [app.requirePermission('analytics:read')], schema: { tags: ['admin'] } },
    async () => {
      const since = new Date(Date.now() - 30 * 86_400_000);

      const [byTrust, byMethod, totals, alertsOpen] = await Promise.all([
        db.verificationEvent.groupBy({
          by: ['trustLevel'],
          where: { createdAt: { gte: since } },
          _count: true,
        }),
        db.verificationEvent.groupBy({
          by: ['method'],
          where: { createdAt: { gte: since } },
          _count: true,
        }),
        Promise.all([
          db.jerseyUnit.count({ where: { deletedAt: null } }),
          db.jerseyUnit.count({ where: { state: 'ACTIVATED' } }),
          db.jerseyUnit.count({ where: { state: 'SOLD' } }),
          db.jerseyUnit.count({ where: { state: 'QUARANTINED' } }),
          db.nfcChip.count(),
        ]),
        db.riskAlert.count({ where: { state: 'OPEN' } }),
      ]);

      const [units, activated, sold, quarantined, chips] = totals;

      return {
        windowDays: 30,
        units: { total: units, activated, sold, quarantined },
        chips: { total: chips },
        alerts: { open: alertsOpen },
        verificationsByTrustLevel: Object.fromEntries(
          byTrust.map((r) => [r.trustLevel, r._count]),
        ),
        verificationsByMethod: Object.fromEntries(byMethod.map((r) => [r.method, r._count])),
      };
    },
  );

  /**
   * Analitica para patrocinadores.
   *
   * Devuelve SOLO metricas materializadas de SU campana, con supresion de
   * cohortes pequenas. No consulta la tabla de eventos ni devuelve filas.
   */
  app.get(
    '/analytics/campaign/:campaignId',
    {
      // Puerta debil a proposito: el ambito viene en la ruta, no se conoce en el
      // preHandler. El manejador comprueba el ambito exacto justo debajo; esa
      // comprobacion NO es redundante, es la que realmente aisla las campanas.
      preHandler: [app.requirePermissionInAnyScope('analytics:campaign_scoped')],
      schema: { tags: ['admin'], summary: 'Metricas agregadas de una campana' },
    },
    async (request) => {
      const { campaignId } = z.object({ campaignId: z.string().uuid() }).parse(request.params);
      const user = request.currentUser!;

      // Comprobacion de ambito. El preHandler solo verifico que el permiso
      // exista en ALGUN ambito; esta linea es la que impide que un patrocinador
      // con alcance sobre la campana A lea la campana B.
      const scoped = hasAccess(user.assignments, {
        permission: 'analytics:campaign_scoped',
        scopeType: 'CAMPAIGN',
        scopeId: campaignId,
      });
      const isGlobalAnalyst = hasAccess(user.assignments, { permission: 'analytics:read' });

      if (!scoped && !isGlobalAnalyst) {
        throw forbidden('No tiene acceso a las metricas de esta campana.');
      }

      const metrics = await db.campaignMetric.findMany({
        where: { campaignId },
        orderBy: { bucketDate: 'asc' },
      });

      return {
        campaignId,
        minCohortSize: MIN_AGGREGATE_COHORT_SIZE,
        note:
          'Los valores con cohorte inferior al minimo se muestran como null para impedir ' +
          'la reidentificacion de personas.',
        metrics: metrics.map((m) => ({
          metricKey: m.metricKey,
          date: m.bucketDate.toISOString().slice(0, 10),
          value: m.suppressed ? null : suppressSmallCohort(m.value),
        })),
      };
    },
  );
}

/**
 * Permisos que `/me` devuelve al cliente.
 *
 * Se DERIVA de `PERMISSIONS` del dominio en lugar de mantenerse a mano. La
 * version anterior era una copia manual y omitia `support:write`,
 * `privacy:write` y `ownership:write`: el servidor los concedia, la interfaz no
 * se enteraba, y todos los controles de escritura de soporte quedaban ocultos.
 * Un espejo manual de una lista que vive en otro sitio siempre acaba divergiendo.
 *
 * No hay nada sensible en decirle a una persona que permisos tiene: son los
 * suyos, y la autorizacion real se aplica en cada peticion.
 */
const ALL_UI_PERMISSIONS: readonly Permission[] = PERMISSIONS;
