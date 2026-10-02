import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateTransferToken,
  hashToken,
  maskPublicRef,
  CONSENT_PURPOSES,
  type TrustLevel,
} from '@mev/domain';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { burnTime, hashPassword, validatePasswordStrength, verifyPassword } from '../lib/passwords.js';
import { createFanSession, revokeUserSession } from '../auth/sessions.js';
import { buildRequestContext } from '../lib/request-context.js';
import { recordAudit } from '../lib/audit.js';
import { isUniqueViolation } from '../lib/idempotency.js';
import { CURRENT_POLICY_VERSION } from './public.js';

/**
 * Rutas del aficionado. TODAS son opcionales para el producto:
 * verificar un jersey no pasa por aqui.
 */

/** Ventana de aceptacion de una invitacion de transferencia. */
const TRANSFER_TTL_DAYS = 7;

export default async function fanRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;
  const pepper = config.TOKEN_HASH_PEPPER;

  // --- Cuenta ---------------------------------------------------------------

  app.post(
    '/register',
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_PUBLIC_FORMS_PER_HOUR,
          timeWindow: '1 hour',
        },
      },
      schema: { tags: ['aficionado'], summary: 'Crea una cuenta de aficionado (opcional)' },
    },
    async (request, reply) => {
      const body = z
        .object({
          email: z.string().email().max(320),
          password: z.string().min(1).max(200),
          displayName: z.string().min(1).max(120).optional(),
          locale: z.enum(['es', 'en']).default('es'),
        })
        .parse(request.body);

      const strength = validatePasswordStrength(body.password);
      if (!strength.ok) throw badRequest(strength.reason!);

      const passwordHash = await hashPassword(body.password);

      try {
        const fan = await db.fanAccount.create({
          data: {
            email: body.email.toLowerCase(),
            passwordHash,
            displayName: body.displayName ?? null,
            locale: body.locale,
          },
          select: { id: true, email: true, displayName: true, locale: true },
        });

        const session = await createFanSession(db, { fanId: fan.id, pepper });

        return reply.status(201).send({
          token: session.token,
          expiresAt: session.expiresAt.toISOString(),
          fan,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          // No se revela que el correo ya existe: eso permitiria enumerar
          // cuentas. Se devuelve el mismo error generico que una entrada invalida.
          throw badRequest(
            'No pudimos crear la cuenta con esos datos. Si ya tiene cuenta, inicie sesion.',
          );
        }
        throw error;
      }
    },
  );

  app.post(
    '/login',
    {
      config: { rateLimit: { max: config.RATE_LIMIT_LOGIN_PER_MINUTE, timeWindow: '1 minute' } },
      schema: { tags: ['aficionado'], summary: 'Inicia sesion' },
    },
    async (request) => {
      const body = z
        .object({ email: z.string().email().max(320), password: z.string().max(200) })
        .parse(request.body);

      const fan = await db.fanAccount.findUnique({ where: { email: body.email.toLowerCase() } });

      if (!fan || !fan.passwordHash || !fan.active || fan.deletedAt) {
        // Se consume tiempo equivalente para que la respuesta no revele si el
        // correo existe. Ver lib/passwords.ts
        await burnTime(body.password);
        throw unauthorized('Correo o contrasena incorrectos');
      }

      if (!(await verifyPassword(fan.passwordHash, body.password))) {
        throw unauthorized('Correo o contrasena incorrectos');
      }

      const session = await createFanSession(db, { fanId: fan.id, pepper });

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        fan: {
          id: fan.id,
          email: fan.email,
          displayName: fan.displayName,
          locale: fan.locale,
          loyaltyTier: fan.loyaltyTier,
        },
      };
    },
  );

  app.post(
    '/logout',
    { preHandler: [app.requireFan], schema: { tags: ['aficionado'], summary: 'Cierra sesion' } },
    async (request) => {
      await db.fanSession.updateMany({
        where: { id: request.currentFan!.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: true };
    },
  );

  app.get(
    '/me',
    { preHandler: [app.requireFan], schema: { tags: ['aficionado'], summary: 'Perfil actual' } },
    async (request) => {
      const fan = request.currentFan!;
      return {
        id: fan.id,
        email: fan.email,
        displayName: fan.displayName,
        locale: fan.locale,
        loyaltyTier: fan.loyaltyTier,
      };
    },
  );

  // --- Prendas --------------------------------------------------------------

  app.get(
    '/jerseys',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Prendas de las que es titular' },
    },
    async (request) => {
      const ownerships = await db.ownership.findMany({
        where: { fanId: request.currentFan!.id, endedAt: null },
        include: {
          jerseyUnit: {
            include: { jerseyModel: { include: { club: true, season: true } }, player: true },
          },
        },
        orderBy: { startedAt: 'desc' },
      });

      return {
        jerseys: ownerships.map((o) => ({
          unitHandle: o.jerseyUnit.id,
          maskedRef: maskPublicRef(o.jerseyUnit.publicRef),
          club: o.jerseyUnit.jerseyModel.club.name,
          season: o.jerseyUnit.jerseyModel.season.name,
          model: o.jerseyUnit.jerseyModel.name,
          edition: o.jerseyUnit.jerseyModel.edition,
          playerName: o.jerseyUnit.player?.fullName ?? o.jerseyUnit.playerNameOnShirt ?? null,
          shirtNumber: o.jerseyUnit.shirtNumber ?? null,
          condition: o.jerseyUnit.condition,
          acquiredVia: o.acquiredVia,
          since: o.startedAt.toISOString(),
        })),
      };
    },
  );

  /**
   * Historial permitido de una prenda.
   *
   * MUESTRA: cuantas veces cambio de manos y en que fechas aproximadas.
   * NO MUESTRA: quien fue el propietario anterior, su correo, ni desde donde
   * verifico. El historial sirve para dar contexto de coleccion, no para
   * rastrear a las personas que tuvieron la prenda.
   */
  app.get(
    '/jerseys/:handle/history',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Historial permitido de la prenda' },
    },
    async (request) => {
      const { handle } = z.object({ handle: z.string().uuid() }).parse(request.params);

      const owns = await db.ownership.findFirst({
        where: { jerseyUnitId: handle, fanId: request.currentFan!.id, endedAt: null },
        select: { id: true },
      });
      if (!owns) throw notFound('Prenda no encontrada');

      const [ownerships, unit] = await Promise.all([
        db.ownership.findMany({
          where: { jerseyUnitId: handle },
          orderBy: { startedAt: 'asc' },
          select: { startedAt: true, endedAt: true, acquiredVia: true, fanId: true },
        }),
        db.jerseyUnit.findUnique({
          where: { id: handle },
          select: { activatedAt: true, interactionCount: true, condition: true },
        }),
      ]);

      const currentFanId = request.currentFan!.id;

      return {
        activatedAt: unit?.activatedAt?.toISOString() ?? null,
        interactionCount: unit?.interactionCount ?? 0,
        condition: unit?.condition ?? 'NEW',
        ownerCount: ownerships.length,
        timeline: ownerships.map((o, index) => ({
          position: index + 1,
          // Solo se distingue "usted" del resto; nadie mas se identifica.
          isYou: o.fanId === currentFanId,
          acquiredVia: o.acquiredVia,
          // Precision de mes: una fecha exacta mas el modelo puede reidentificar.
          from: o.startedAt.toISOString().slice(0, 7),
          to: o.endedAt ? o.endedAt.toISOString().slice(0, 7) : null,
        })),
      };
    },
  );

  /**
   * Reclamar una prenda.
   *
   * Exige haberla verificado: el cuerpo lleva la referencia del evento de
   * verificacion, que debe ser reciente y de la misma unidad. Sin esto,
   * cualquiera con un identificador filtrado podria reclamar prendas ajenas.
   */
  app.post(
    '/claims',
    {
      preHandler: [app.requireFan],
      config: { rateLimit: { max: config.RATE_LIMIT_FAN_WRITE_PER_HOUR, timeWindow: '1 hour' } },
      schema: { tags: ['aficionado'], summary: 'Reclama la titularidad de una prenda' },
    },
    async (request, reply) => {
      const body = z
        .object({ unitHandle: z.string().uuid(), eventRef: z.string().uuid() })
        .parse(request.body);

      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);
      const fanId = request.currentFan!.id;

      const event = await db.verificationEvent.findUnique({
        where: { id: body.eventRef },
        select: { jerseyUnitId: true, createdAt: true, trustLevel: true },
      });

      if (!event || event.jerseyUnitId !== body.unitHandle) {
        throw badRequest('Verifique la prenda antes de reclamarla.');
      }

      // La verificacion debe ser reciente: demuestra tenencia fisica ahora,
      // no en algun momento del pasado.
      if (Date.now() - event.createdAt.getTime() > 30 * 60_000) {
        throw badRequest('La verificacion caduco. Vuelva a acercar el telefono al escudo.');
      }

      const claimable: TrustLevel[] = ['VERIFIED', 'IDENTIFIED_ONLY'];
      if (!claimable.includes(event.trustLevel as TrustLevel)) {
        throw forbidden('Esta prenda no puede reclamarse con el resultado de esa lectura.');
      }

      const unit = await db.jerseyUnit.findFirst({
        where: { id: body.unitHandle, state: { in: ['ACTIVATED', 'SOLD'] }, deletedAt: null },
        select: { id: true, publicRef: true },
      });
      if (!unit) throw notFound('Prenda no disponible para reclamo');

      try {
        // El indice unico parcial `Ownership_active_unique` garantiza que dos
        // reclamos concurrentes no creen dos titularidades activas.
        const ownership = await db.ownership.create({
          data: { jerseyUnitId: unit.id, fanId, acquiredVia: 'CLAIM' },
          select: { id: true, startedAt: true },
        });

        await db.jerseyUnit.update({
          where: { id: unit.id },
          data: { state: 'SOLD', soldAt: new Date() },
        });

        await recordAudit(db, {
          actorId: null,
          actorType: 'FAN',
          action: 'ownership.claimed',
          entityType: 'JerseyUnit',
          entityId: unit.id,
          metadata: { fanId, ownershipId: ownership.id },
          ipPrefix: context.ipPrefix,
        });

        return reply.status(201).send({
          ok: true,
          unitHandle: unit.id,
          maskedRef: maskPublicRef(unit.publicRef),
          since: ownership.startedAt.toISOString(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Esta prenda ya tiene un titular registrado.');
        }
        throw error;
      }
    },
  );

  // --- Transferencias -------------------------------------------------------

  app.post(
    '/transfers',
    {
      preHandler: [app.requireFan],
      config: { rateLimit: { max: config.RATE_LIMIT_FAN_WRITE_PER_HOUR, timeWindow: '1 hour' } },
      schema: { tags: ['aficionado'], summary: 'Inicia una transferencia de titularidad' },
    },
    async (request, reply) => {
      const body = z
        .object({ unitHandle: z.string().uuid(), toEmail: z.string().email().max(320) })
        .parse(request.body);

      const fanId = request.currentFan!.id;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      if (body.toEmail.toLowerCase() === request.currentFan!.email.toLowerCase()) {
        throw badRequest('No puede transferirse la prenda a usted mismo.');
      }

      const ownership = await db.ownership.findFirst({
        where: { jerseyUnitId: body.unitHandle, fanId, endedAt: null },
        select: { id: true },
      });
      if (!ownership) throw forbidden('No es titular de esta prenda.');

      const unit = await db.jerseyUnit.findUnique({
        where: { id: body.unitHandle },
        select: { state: true },
      });
      if (!unit || unit.state === 'REVOKED' || unit.state === 'QUARANTINED') {
        throw forbidden('Esta prenda no puede transferirse en este momento.');
      }

      const token = generateTransferToken();

      try {
        // El indice unico parcial impide dos transferencias pendientes a la vez.
        const transfer = await db.ownershipTransfer.create({
          data: {
            jerseyUnitId: body.unitHandle,
            fromFanId: fanId,
            toEmail: body.toEmail.toLowerCase(),
            tokenHash: hashToken(token, pepper),
            expiresAt: new Date(Date.now() + TRANSFER_TTL_DAYS * 86_400_000),
          },
          select: { id: true, expiresAt: true },
        });

        await recordAudit(db, {
          actorType: 'FAN',
          action: 'transfer.started',
          entityType: 'OwnershipTransfer',
          entityId: transfer.id,
          metadata: { fanId, unitHandle: body.unitHandle },
          ipPrefix: context.ipPrefix,
        });

        return reply.status(201).send({
          transferId: transfer.id,
          expiresAt: transfer.expiresAt.toISOString(),
          /**
           * El token se devuelve UNA sola vez, a quien inicia la transferencia.
           * En produccion se enviaria por correo al destinatario; en el piloto
           * se entrega aqui para que el titular comparta el enlace por el canal
           * que prefiera. No vuelve a estar disponible.
           */
          invitationToken: token,
          message: 'Comparta este enlace con la persona destinataria. Caduca en 7 dias.',
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Ya existe una transferencia pendiente para esta prenda.');
        }
        throw error;
      }
    },
  );

  app.post(
    '/transfers/accept',
    {
      preHandler: [app.requireFan],
      config: { rateLimit: { max: config.RATE_LIMIT_FAN_WRITE_PER_HOUR, timeWindow: '1 hour' } },
      schema: { tags: ['aficionado'], summary: 'Acepta una transferencia recibida' },
    },
    async (request) => {
      const body = z.object({ token: z.string().min(16).max(256) }).parse(request.body);
      const fan = request.currentFan!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const transfer = await db.ownershipTransfer.findUnique({
        where: { tokenHash: hashToken(body.token, pepper) },
      });

      if (!transfer || transfer.state !== 'PENDING') {
        throw notFound('Esta invitacion no es valida.');
      }
      if (transfer.expiresAt < new Date()) {
        await db.ownershipTransfer.update({
          where: { id: transfer.id },
          data: { state: 'EXPIRED' },
        });
        throw badRequest('Esta invitacion caduco. Pida al titular que genere una nueva.');
      }
      if (transfer.fromFanId === fan.id) {
        throw badRequest('No puede aceptar su propia transferencia.');
      }
      // Si la invitacion se dirigio a un correo concreto, solo esa cuenta la acepta.
      if (transfer.toEmail && transfer.toEmail.toLowerCase() !== fan.email.toLowerCase()) {
        throw forbidden('Esta invitacion fue emitida para otra persona.');
      }

      // Todo o nada: cerrar la titularidad anterior y abrir la nueva deben
      // ocurrir juntas, o la prenda quedaria sin titular o con dos.
      await db.$transaction(async (tx) => {
        await tx.ownership.updateMany({
          where: { jerseyUnitId: transfer.jerseyUnitId, endedAt: null },
          data: { endedAt: new Date() },
        });

        await tx.ownership.create({
          data: {
            jerseyUnitId: transfer.jerseyUnitId,
            fanId: fan.id,
            acquiredVia: 'TRANSFER',
          },
        });

        await tx.ownershipTransfer.update({
          where: { id: transfer.id },
          data: { state: 'ACCEPTED', toFanId: fan.id, acceptedAt: new Date() },
        });

        await tx.jerseyUnit.update({
          where: { id: transfer.jerseyUnitId },
          data: { condition: 'TRANSFERRED' },
        });

        await recordAudit(tx, {
          actorType: 'FAN',
          action: 'transfer.completed',
          entityType: 'OwnershipTransfer',
          entityId: transfer.id,
          metadata: { toFanId: fan.id, unitHandle: transfer.jerseyUnitId },
          ipPrefix: context.ipPrefix,
        });
      });

      return { ok: true, unitHandle: transfer.jerseyUnitId };
    },
  );

  app.post(
    '/transfers/:id/cancel',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Cancela una transferencia pendiente' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const result = await db.ownershipTransfer.updateMany({
        where: { id, fromFanId: request.currentFan!.id, state: 'PENDING' },
        data: { state: 'CANCELLED', cancelledAt: new Date() },
      });

      if (result.count === 0) throw notFound('No hay una transferencia pendiente con ese dato.');
      return { ok: true };
    },
  );

  // --- Consentimientos ------------------------------------------------------

  app.get(
    '/consents',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Consentimientos actuales' },
    },
    async (request) => {
      const records = await db.consent.findMany({ where: { fanId: request.currentFan!.id } });
      const byPurpose = new Map(records.map((r) => [r.purpose, r]));

      return {
        policyVersion: CURRENT_POLICY_VERSION,
        consents: CONSENT_PURPOSES.map((purpose) => {
          const record = byPurpose.get(purpose);
          return {
            purpose,
            granted: record ? record.granted && record.revokedAt == null : false,
            updatedAt: record?.updatedAt.toISOString() ?? null,
            policyVersion: record?.policyVersion ?? null,
          };
        }),
      };
    },
  );

  app.put(
    '/consents',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Otorga o revoca un consentimiento' },
    },
    async (request) => {
      const body = z
        .object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean() })
        .parse(request.body);

      const fanId = request.currentFan!.id;
      const now = new Date();

      await db.consent.upsert({
        where: { fanId_purpose: { fanId, purpose: body.purpose } },
        create: {
          fanId,
          purpose: body.purpose,
          granted: body.granted,
          grantedAt: body.granted ? now : null,
          revokedAt: body.granted ? null : now,
          policyVersion: CURRENT_POLICY_VERSION,
        },
        update: {
          granted: body.granted,
          grantedAt: body.granted ? now : undefined,
          // Revocar deja rastro: es la prueba de que la persona ejercio su derecho.
          revokedAt: body.granted ? null : now,
          policyVersion: CURRENT_POLICY_VERSION,
        },
      });

      return { ok: true, purpose: body.purpose, granted: body.granted };
    },
  );

  // --- Recompensas ----------------------------------------------------------

  app.get(
    '/rewards',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Recompensas disponibles' },
    },
    async (request) => {
      const now = new Date();
      const rewards = await db.reward.findMany({
        where: {
          active: true,
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
        },
        select: {
          id: true,
          name: true,
          description: true,
          kind: true,
          minTrustLevel: true,
          stock: true,
        },
      });

      const redeemed = await db.rewardRedemption.findMany({
        where: { fanId: request.currentFan!.id },
        select: { rewardId: true },
      });
      const redeemedIds = new Set(redeemed.map((r) => r.rewardId));

      return {
        rewards: rewards.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          kind: r.kind,
          minTrustLevel: r.minTrustLevel,
          available: (r.stock ?? 1) > 0,
          alreadyRedeemed: redeemedIds.has(r.id),
        })),
      };
    },
  );

  app.post(
    '/rewards/:id/redeem',
    {
      preHandler: [app.requireFan],
      config: { rateLimit: { max: config.RATE_LIMIT_FAN_WRITE_PER_HOUR, timeWindow: '1 hour' } },
      schema: { tags: ['aficionado'], summary: 'Canjea una recompensa' },
    },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({ unitHandle: z.string().uuid(), eventRef: z.string().uuid() })
        .parse(request.body);

      const fanId = request.currentFan!.id;

      const reward = await db.reward.findFirst({ where: { id, active: true } });
      if (!reward) throw notFound('Recompensa no disponible');
      if (reward.stock != null && reward.stock <= 0) {
        throw conflict('Esta recompensa se agoto.');
      }

      const event = await db.verificationEvent.findUnique({
        where: { id: body.eventRef },
        select: { jerseyUnitId: true, trustLevel: true, createdAt: true },
      });
      if (!event || event.jerseyUnitId !== body.unitHandle) {
        throw badRequest('Verifique la prenda antes de canjear.');
      }

      // Una lectura sospechosa, revocada o no verificable NUNCA canjea.
      // Es el control que impide monetizar un identificador copiado.
      const ORDER: TrustLevel[] = ['UNVERIFIABLE', 'IDENTIFIED_ONLY', 'VERIFIED'];
      const eventRank = ORDER.indexOf(event.trustLevel as TrustLevel);
      const requiredRank = ORDER.indexOf(reward.minTrustLevel as TrustLevel);
      if (eventRank < 0 || eventRank < requiredRank) {
        throw forbidden('El nivel de verificacion de esa lectura no permite canjear esta recompensa.');
      }

      const ownsUnit = await db.ownership.findFirst({
        where: { jerseyUnitId: body.unitHandle, fanId, endedAt: null },
        select: { id: true },
      });
      if (reward.requiresAccount && !ownsUnit) {
        throw forbidden('Debe ser titular de la prenda para canjear esta recompensa.');
      }

      try {
        const redemption = await db.$transaction(async (tx) => {
          const created = await tx.rewardRedemption.create({
            data: { rewardId: id, fanId, jerseyUnitId: body.unitHandle },
            select: { id: true, redeemedAt: true },
          });
          if (reward.stock != null) {
            await tx.reward.update({ where: { id }, data: { stock: { decrement: 1 } } });
          }
          return created;
        });

        return reply.status(201).send({
          ok: true,
          redemptionId: redemption.id,
          redeemedAt: redemption.redeemedAt.toISOString(),
          reward: { name: reward.name, kind: reward.kind },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Ya canjeo esta recompensa con esta prenda.');
        }
        throw error;
      }
    },
  );

  // --- Casos de soporte propios --------------------------------------------

  /**
   * Casos de soporte de la persona autenticada, con las respuestas que soporte
   * marco como visibles.
   *
   * Es la otra mitad del circuito: sin esta ruta, soporte podia responder y la
   * respuesta no llegaba a ninguna parte. Las notas INTERNAS nunca se devuelven
   * aqui; el filtro es explicito, no depende de que quien consulte se acuerde.
   */
  app.get(
    '/support-cases',
    {
      preHandler: [app.requireFan],
      schema: { tags: ['aficionado'], summary: 'Mis casos de soporte y sus respuestas' },
    },
    async (request) => {
      const fan = request.currentFan!;

      const casos = await db.supportCase.findMany({
        // Se incluyen los casos abiertos con su correo antes de tener cuenta: de
        // lo contrario, registrarse despues de escribir haria desaparecer el caso.
        where: { OR: [{ fanId: fan.id }, { contactEmail: fan.email }] },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          notes: {
            where: { visibleToCustomer: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true, body: true, createdAt: true },
          },
          jerseyUnit: { select: { publicRef: true } },
        },
      });

      return {
        cases: casos.map((c) => ({
          id: c.id,
          reason: c.reason,
          state: c.state,
          subject: c.subject,
          createdAt: c.createdAt.toISOString(),
          resolvedAt: c.resolvedAt?.toISOString() ?? null,
          maskedRef: c.jerseyUnit ? maskPublicRef(c.jerseyUnit.publicRef) : null,
          // Solo las notas marcadas como visibles. Nunca el responsable interno
          // ni las notas de trabajo.
          replies: c.notes.map((n) => ({
            id: n.id,
            body: n.body,
            createdAt: n.createdAt.toISOString(),
          })),
        })),
      };
    },
  );
}

export { revokeUserSession };
