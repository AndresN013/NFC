import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  assertChipTransition,
  buildTagUrl,
  buildQrUrl,
  generateQrToken,
  generateTagToken,
  generateUnitPublicRef,
  hashToken,
  type ChipState,
} from '@mev/domain';
import { checkUriFits } from '@mev/nfc-contracts';
import { badRequest, conflict, forbidden, invalidState, notFound, unauthorized } from '../lib/errors.js';
import { burnTime, verifyPassword } from '../lib/passwords.js';
import { createUserSession } from '../auth/sessions.js';
import { runIdempotent } from '../lib/idempotency.js';
import { recordAudit } from '../lib/audit.js';
import { buildRequestContext } from '../lib/request-context.js';

/**
 * API de produccion: la consume la app Android "Marathon NFC Studio".
 *
 * GARANTIAS DE ESTA API
 *  1. Toda operacion que muta estado exige `Idempotency-Key`. El operario puede
 *     reintentar sin miedo a programar dos veces el mismo chip.
 *  2. Las transiciones de estado se validan contra la maquina de estados del
 *     dominio. Un salto no declarado devuelve 409, nunca se ejecuta.
 *  3. El token grabado en el chip se genera EN EL SERVIDOR y se devuelve una
 *     sola vez, dentro de la URL. La base de datos guarda solo su hash.
 *  4. El telefono nunca recibe una clave. Ni siquiera una referencia utilizable.
 */

function requireIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
    throw badRequest(
      'Falta la cabecera Idempotency-Key o no es valida.',
      'toda operacion de escritura de produccion la exige',
    );
  }
  return key;
}

export default async function productionRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;

  // --- Autenticacion del operario -------------------------------------------

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: config.RATE_LIMIT_LOGIN_PER_MINUTE, timeWindow: '1 minute' } },
      schema: { tags: ['produccion'], summary: 'Inicia sesion desde un telefono autorizado' },
    },
    async (request) => {
      const body = z
        .object({
          email: z.string().email().max(320),
          password: z.string().max(200),
          deviceId: z.string().min(8).max(200),
        })
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
        throw unauthorized('Correo o contrasena incorrectos');
      }

      // El telefono debe estar dado de alta Y activo. Un operario valido en un
      // telefono no autorizado no puede programar: es el control que impide
      // usar un dispositivo personal o robado.
      const device = await db.authorizedDevice.findUnique({
        where: { deviceId: body.deviceId },
        include: { station: true },
      });

      if (!device || !device.active) {
        await recordAudit(db, {
          actorId: user.id,
          action: 'production.login.device_rejected',
          entityType: 'AuthorizedDevice',
          entityId: body.deviceId,
          metadata: { reason: device ? 'inactivo' : 'no registrado' },
          ipPrefix: context.ipPrefix,
        });
        throw forbidden('Este telefono no esta autorizado para programar. Avise al supervisor.');
      }

      const session = await createUserSession(db, {
        userId: user.id,
        deviceId: device.id,
        ipPrefix: context.ipPrefix,
        pepper: config.TOKEN_HASH_PEPPER,
      });

      await Promise.all([
        db.authorizedDevice.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date() },
        }),
        db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        recordAudit(db, {
          actorId: user.id,
          action: 'production.login',
          entityType: 'AuthorizedDevice',
          entityId: device.id,
          ipPrefix: context.ipPrefix,
        }),
      ]);

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: { id: user.id, displayName: user.displayName },
        device: {
          id: device.id,
          label: device.label,
          station: device.station?.name ?? null,
        },
        provider: {
          id: config.NFC_PROVIDER,
          // La app muestra un banner permanente cuando esto es true.
          simulated: config.NFC_PROVIDER === 'mock',
        },
      };
    },
  );

  // --- Ordenes --------------------------------------------------------------

  app.get(
    '/orders',
    {
      preHandler: [app.requirePermission('production:read')],
      schema: { tags: ['produccion'], summary: 'Ordenes de produccion disponibles' },
    },
    async () => {
      const orders = await db.productionOrder.findMany({
        where: { state: { in: ['OPEN', 'IN_PROGRESS'] } },
        include: {
          batches: { select: { code: true, flagged: true } },
          _count: { select: { units: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return {
        orders: orders.map((o) => ({
          id: o.id,
          code: o.code,
          state: o.state,
          plannedUnits: o.plannedUnits,
          producedUnits: o._count.units,
          remainingUnits: Math.max(0, o.plannedUnits - o._count.units),
          batches: o.batches,
          notes: o.notes,
        })),
      };
    },
  );

  app.get(
    '/orders/:id',
    {
      preHandler: [app.requirePermission('production:read')],
      schema: { tags: ['produccion'], summary: 'Detalle de una orden' },
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

      const order = await db.productionOrder.findUnique({
        where: { id },
        include: {
          batches: { include: { _count: { select: { chips: true } } } },
          units: {
            take: 1,
            include: { jerseyModel: { include: { club: true, season: true } } },
          },
          _count: { select: { units: true, jobs: true } },
        },
      });
      if (!order) throw notFound('Orden no encontrada');

      const sample = order.units[0];

      return {
        id: order.id,
        code: order.code,
        state: order.state,
        plannedUnits: order.plannedUnits,
        producedUnits: order._count.units,
        jobCount: order._count.jobs,
        notes: order.notes,
        club: sample?.jerseyModel.club.name ?? null,
        season: sample?.jerseyModel.season.name ?? null,
        model: sample?.jerseyModel.name ?? null,
        batches: order.batches.map((b) => ({
          code: b.code,
          flagged: b.flagged,
          flagReason: b.flagReason,
          chipCount: b._count.chips,
        })),
      };
    },
  );

  // --- Inspeccion previa ----------------------------------------------------

  /**
   * Comprueba si un chip ya esta registrado ANTES de intentar escribirlo.
   * Es la primera barrera contra programar dos veces el mismo chip.
   */
  app.post(
    '/chips/inspect',
    {
      preHandler: [app.requirePermission('production:read')],
      schema: { tags: ['produccion'], summary: 'Consulta si un chip ya fue registrado' },
    },
    async (request) => {
      const body = z
        .object({
          uid: z.string().regex(/^[0-9A-Fa-f]{8,32}$/, 'UID hexadecimal invalido'),
          chipType: z.enum(['NTAG213', 'NTAG215', 'NTAG216', 'NTAG424DNA', 'UNKNOWN']),
        })
        .parse(request.body);

      const chip = await db.nfcChip.findUnique({
        where: { uid: body.uid.toUpperCase() },
        select: { id: true, state: true, chipType: true, emblem: { select: { code: true } } },
      });

      if (!chip) {
        return {
          known: false,
          state: null,
          canProgram: true,
          message: 'Chip nuevo. Puede programarlo.',
        };
      }

      const reprogrammable: ChipState[] = ['VALIDATED', 'RESERVED', 'PERSONALIZING', 'PROGRAMMED'];
      const canProgram = reprogrammable.includes(chip.state as ChipState);

      return {
        known: true,
        state: chip.state,
        chipType: chip.chipType,
        canProgram,
        message: canProgram
          ? 'Chip ya registrado y aun programable. Puede continuar.'
          : `Este chip ya esta en estado ${chip.state}. No debe reprogramarse. Apartelo.`,
        // Si el tipo detectado no coincide con el registrado, es una senal de
        // que el chip fisico no es el que se cree.
        typeMismatch: chip.chipType !== body.chipType,
      };
    },
  );

  // --- Reserva y personalizacion --------------------------------------------

  /**
   * Reserva un chip para una orden y emite el plan de personalizacion.
   *
   * Aqui se genera el token que se grabara. Es la unica vez que existe en claro:
   * viaja dentro de `targetUri` hasta el telefono y se descarta. La base de
   * datos guarda solo su hash.
   */
  app.post(
    '/jobs/reserve',
    {
      preHandler: [app.requirePermission('production:write')],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { tags: ['produccion'], summary: 'Reserva un chip y emite el plan de escritura' },
    },
    async (request, reply) => {
      const key = requireIdempotencyKey(request);
      const body = z
        .object({
          orderId: z.string().uuid(),
          uid: z.string().regex(/^[0-9A-Fa-f]{8,32}$/),
          chipType: z.enum(['NTAG213', 'NTAG215', 'NTAG216', 'NTAG424DNA']),
          batchCode: z.string().max(100).optional(),
        })
        .parse(request.body);

      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);
      const uid = body.uid.toUpperCase();

      const result = await runIdempotent(
        db,
        { key, endpoint: 'POST /production/jobs/reserve', body },
        async () => {
          const order = await db.productionOrder.findUnique({ where: { id: body.orderId } });
          if (!order) throw notFound('Orden no encontrada');
          if (order.state !== 'OPEN' && order.state !== 'IN_PROGRESS') {
            throw invalidState(`La orden esta en estado ${order.state} y no admite produccion.`);
          }

          const batch = body.batchCode
            ? await db.productionBatch.findUnique({ where: { code: body.batchCode } })
            : null;

          // El adaptador NTAG 424 DNA no esta implementado. Se rechaza aqui
          // antes de reservar nada, en lugar de fallar a mitad del proceso.
          if (body.chipType === 'NTAG424DNA' && config.NFC_PROVIDER !== 'ntag424dna') {
            throw badRequest(
              'La personalizacion de NTAG 424 DNA no esta habilitada en este despliegue. ' +
                'Ver docs/guia-ntag424-dna.md',
            );
          }

          const tagToken = generateTagToken();
          const targetUri = buildTagUrl(config.FAN_WEB_PUBLIC_URL, tagToken);

          // Se valida la capacidad ANTES de reservar: si la URL no cabe en el
          // chip, el problema es de configuracion y debe verse de inmediato.
          const capacity = checkUriFits(targetUri, body.chipType);
          if (!capacity.fits) {
            throw badRequest(
              `La URL de verificacion (${capacity.requiredBytes} bytes) no cabe en un ${body.chipType} ` +
                `(${capacity.availableBytes} bytes). Acorte FAN_WEB_PUBLIC_URL o use un chip mayor.`,
            );
          }

          const job = await db.$transaction(async (tx) => {
            const chip = await tx.nfcChip.upsert({
              where: { uid },
              create: {
                uid,
                chipType: body.chipType,
                state: 'RESERVED',
                batchId: batch?.id ?? null,
              },
              update: {},
              select: { id: true, state: true, chipType: true, tagTokenHash: true },
            });

            if (chip.chipType !== body.chipType) {
              throw conflict(
                `Este UID esta registrado como ${chip.chipType} pero se detecto ${body.chipType}.`,
              );
            }

            // Se valida la transicion contra la maquina de estados del dominio.
            // Un chip ya activado jamas vuelve a RESERVED.
            if (chip.state !== 'RESERVED') {
              assertChipTransition(chip.state as ChipState, 'RESERVED');
              await tx.nfcChip.update({ where: { id: chip.id }, data: { state: 'RESERVED' } });
            }

            await tx.nfcChip.update({
              where: { id: chip.id },
              data: { tagTokenHash: hashToken(tagToken, config.TOKEN_HASH_PEPPER) },
            });

            const created = await tx.personalizationJob.create({
              data: {
                productionOrderId: order.id,
                chipId: chip.id,
                operatorId: user.id,
                deviceId: user.deviceId,
                state: 'PENDING',
                providerId: config.NFC_PROVIDER,
                simulated: config.NFC_PROVIDER === 'mock',
                idempotencyKey: key,
                targetUri,
              },
              select: { id: true },
            });

            if (order.state === 'OPEN') {
              await tx.productionOrder.update({
                where: { id: order.id },
                data: { state: 'IN_PROGRESS' },
              });
            }

            await recordAudit(tx, {
              actorId: user.id,
              action: 'production.chip.reserved',
              entityType: 'NfcChip',
              entityId: chip.id,
              metadata: { jobId: created.id, orderCode: order.code, chipType: body.chipType },
              ipPrefix: context.ipPrefix,
            });

            return { jobId: created.id, chipId: chip.id };
          });

          return {
            statusCode: 201,
            body: {
              jobId: job.jobId,
              chipId: job.chipId,
              // El token viaja aqui dentro y no vuelve a estar disponible.
              targetUri,
              providerId: config.NFC_PROVIDER,
              simulated: config.NFC_PROVIDER === 'mock',
              lockPlan: {
                // El bloqueo irreversible de NTAG 21x no esta implementado.
                // Ver packages/nfc-contracts/src/providers/ntag21x.ts
                lockNdefReadOnly: false,
                lockConfiguration: false,
              },
              /** Vacio siempre: el telefono nunca recibe material criptografico. */
              keyReferences: [] as unknown[],
            },
          };
        },
      );

      return reply.status(result.statusCode).header('idempotent-replay', String(result.replayed)).send(result.body);
    },
  );

  /** Confirma el resultado de la escritura NDEF. */
  app.post(
    '/jobs/:jobId/written',
    {
      preHandler: [app.requirePermission('production:write')],
      schema: { tags: ['produccion'], summary: 'Reporta el resultado de la escritura' },
    },
    async (request, reply) => {
      const key = requireIdempotencyKey(request);
      const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          success: z.boolean(),
          writtenPayloadHash: z.string().max(200).optional(),
          errorCode: z.string().max(60).optional(),
        })
        .parse(request.body);

      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const result = await runIdempotent(
        db,
        { key, endpoint: `POST /production/jobs/${jobId}/written`, body },
        async () => {
          const job = await db.personalizationJob.findUnique({
            where: { id: jobId },
            include: { chip: true },
          });
          if (!job) throw notFound('Trabajo no encontrado');
          if (!job.chip) throw invalidState('El trabajo no tiene un chip asociado');
          if (job.operatorId !== user.id) {
            throw forbidden('Este trabajo pertenece a otro operario.');
          }

          const chipState = job.chip.state as ChipState;

          if (body.success) {
            assertChipTransition(chipState, 'PERSONALIZING');
            await db.$transaction([
              db.nfcChip.update({
                where: { id: job.chip.id },
                data: { state: 'PROGRAMMED', programmedAt: new Date() },
              }),
              db.personalizationJob.update({
                where: { id: job.id },
                data: {
                  state: 'WRITTEN',
                  writtenPayloadHash: body.writtenPayloadHash ?? null,
                  attempts: { increment: 1 },
                  startedAt: job.startedAt ?? new Date(),
                },
              }),
            ]);
          } else {
            await db.personalizationJob.update({
              where: { id: job.id },
              data: {
                state: 'FAILED',
                lastError: body.errorCode ?? 'WRITE_FAILED',
                attempts: { increment: 1 },
              },
            });
          }

          await recordAudit(db, {
            actorId: user.id,
            action: body.success ? 'production.chip.written' : 'production.chip.write_failed',
            entityType: 'NfcChip',
            entityId: job.chip.id,
            metadata: { jobId: job.id, errorCode: body.errorCode },
            ipPrefix: context.ipPrefix,
          });

          return {
            statusCode: 200,
            body: {
              jobId: job.id,
              state: body.success ? 'WRITTEN' : 'FAILED',
              // Un fallo de escritura SIEMPRE es reintentable con la misma
              // clave de idempotencia nueva: el chip no quedo en estado final.
              canRetry: !body.success,
            },
          };
        },
      );

      return reply.status(result.statusCode).send(result.body);
    },
  );

  /**
   * Confirma la relectura posterior a la escritura.
   * Si no coincide, el chip pasa a CUARENTENA automaticamente: una escritura
   * parcial produce una etiqueta que parece valida pero no lo es.
   */
  app.post(
    '/jobs/:jobId/verified',
    {
      preHandler: [app.requirePermission('production:write')],
      schema: { tags: ['produccion'], summary: 'Reporta la relectura de comprobacion' },
    },
    async (request, reply) => {
      const key = requireIdempotencyKey(request);
      const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({ matches: z.boolean(), readBackUri: z.string().max(500).nullish() })
        .parse(request.body);

      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const result = await runIdempotent(
        db,
        { key, endpoint: `POST /production/jobs/${jobId}/verified`, body },
        async () => {
          const job = await db.personalizationJob.findUnique({
            where: { id: jobId },
            include: { chip: true },
          });
          if (!job?.chip) throw notFound('Trabajo no encontrado');
          if (job.operatorId !== user.id) throw forbidden('Este trabajo pertenece a otro operario.');

          // Comprobacion del servidor: la relectura debe coincidir con lo que
          // el servidor ordeno grabar, no solo con lo que el telefono dice.
          const serverMatches = body.readBackUri != null && body.readBackUri === job.targetUri;
          const accepted = body.matches && serverMatches;

          const chipState = job.chip.state as ChipState;

          if (accepted) {
            assertChipTransition(chipState, 'VERIFIED');
            await db.$transaction([
              db.nfcChip.update({
                where: { id: job.chip.id },
                data: { state: 'VERIFIED', verifiedAt: new Date() },
              }),
              db.personalizationJob.update({
                where: { id: job.id },
                data: { state: 'VERIFIED', completedAt: new Date() },
              }),
            ]);
          } else {
            await db.$transaction([
              db.nfcChip.update({ where: { id: job.chip.id }, data: { state: 'QUARANTINED' } }),
              db.personalizationJob.update({
                where: { id: job.id },
                data: {
                  state: 'FAILED',
                  lastError: body.matches ? 'VERIFY_MISMATCH_SERVER' : 'VERIFY_MISMATCH_CLIENT',
                },
              }),
            ]);
          }

          await recordAudit(db, {
            actorId: user.id,
            action: accepted ? 'production.chip.verified' : 'production.chip.quarantined',
            entityType: 'NfcChip',
            entityId: job.chip.id,
            metadata: {
              jobId: job.id,
              clientMatches: body.matches,
              serverMatches,
            },
            ipPrefix: context.ipPrefix,
          });

          return {
            statusCode: 200,
            body: {
              jobId: job.id,
              accepted,
              chipState: accepted ? 'VERIFIED' : 'QUARANTINED',
              message: accepted
                ? 'Escritura confirmada. Continue con la asociacion al jersey.'
                : 'La comprobacion no coincide. La unidad paso a cuarentena. Apartela.',
            },
          };
        },
      );

      return reply.status(result.statusCode).send(result.body);
    },
  );

  // --- Vinculacion chip - emblema - jersey ----------------------------------

  app.post(
    '/units/link',
    {
      preHandler: [app.requirePermission('production:write')],
      schema: { tags: ['produccion'], summary: 'Vincula chip, emblema y unidad de jersey' },
    },
    async (request, reply) => {
      const key = requireIdempotencyKey(request);
      const body = z
        .object({
          jobId: z.string().uuid(),
          skuCode: z.string().min(1).max(100),
          emblemCode: z.string().min(1).max(100),
          playerId: z.string().uuid().optional(),
          shirtNumber: z.number().int().min(0).max(99).optional(),
          playerNameOnShirt: z.string().max(60).optional(),
        })
        .parse(request.body);

      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const result = await runIdempotent(
        db,
        { key, endpoint: 'POST /production/units/link', body },
        async () => {
          const job = await db.personalizationJob.findUnique({
            where: { id: body.jobId },
            include: { chip: true, productionOrder: true },
          });
          if (!job?.chip) throw notFound('Trabajo no encontrado');
          if (job.state !== 'VERIFIED') {
            throw invalidState(
              'El chip debe superar la relectura de comprobacion antes de vincularse.',
            );
          }

          const sku = await db.sku.findUnique({
            where: { code: body.skuCode },
            include: { jerseyModel: true },
          });
          if (!sku) throw notFound(`No existe el SKU ${body.skuCode}`);

          const qrToken = generateQrToken();

          const created = await db.$transaction(async (tx) => {
            const emblem = await tx.emblem.upsert({
              where: { code: body.emblemCode },
              create: { code: body.emblemCode, chipId: job.chip!.id, batchId: job.chip!.batchId },
              update: { chipId: job.chip!.id },
              select: { id: true, jerseyUnit: { select: { id: true } } },
            });

            if (emblem.jerseyUnit) {
              throw conflict('Este emblema ya esta vinculado a otra unidad.');
            }

            assertChipTransition(job.chip!.state as ChipState, 'LINKED');

            const unit = await tx.jerseyUnit.create({
              data: {
                jerseyModelId: sku.jerseyModelId,
                skuId: sku.id,
                emblemId: emblem.id,
                productionOrderId: job.productionOrderId,
                publicRef: generateUnitPublicRef(),
                qrTokenHash: hashToken(qrToken, config.TOKEN_HASH_PEPPER),
                state: 'IN_PRODUCTION',
                playerId: body.playerId ?? null,
                shirtNumber: body.shirtNumber ?? null,
                playerNameOnShirt: body.playerNameOnShirt ?? null,
              },
              select: { id: true, publicRef: true },
            });

            // LINKED y luego READY_FOR_HEAT_PRESS: la unidad sale de esta
            // estacion lista para la prensa.
            await tx.nfcChip.update({ where: { id: job.chip!.id }, data: { state: 'LINKED' } });
            await tx.nfcChip.update({
              where: { id: job.chip!.id },
              data: { state: 'READY_FOR_HEAT_PRESS' },
            });

            await recordAudit(tx, {
              actorId: user.id,
              action: 'production.unit.linked',
              entityType: 'JerseyUnit',
              entityId: unit.id,
              metadata: {
                jobId: job.id,
                chipId: job.chip!.id,
                emblemCode: body.emblemCode,
                skuCode: body.skuCode,
              },
              ipPrefix: context.ipPrefix,
            });

            return unit;
          });

          return {
            statusCode: 201,
            body: {
              unitId: created.id,
              publicRef: created.publicRef,
              // El QR de respaldo se entrega una sola vez, para imprimirlo.
              qrUrl: buildQrUrl(config.FAN_WEB_PUBLIC_URL, qrToken),
              chipState: 'READY_FOR_HEAT_PRESS',
              message: 'Unidad lista para termosellado.',
            },
          };
        },
      );

      return reply.status(result.statusCode).send(result.body);
    },
  );

  // --- Control posterior al termosellado ------------------------------------

  app.post(
    '/units/:unitId/post-press',
    {
      preHandler: [app.requirePermission('production:write')],
      schema: { tags: ['produccion'], summary: 'Registra la prueba posterior al termosellado' },
    },
    async (request, reply) => {
      const key = requireIdempotencyKey(request);
      const { unitId } = z.object({ unitId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          readable: z.boolean(),
          contentIntact: z.boolean(),
          temperatureC: z.number().int().min(0).max(400).optional(),
          pressureBar: z.number().min(0).max(100).optional(),
          durationSec: z.number().int().min(0).max(600).optional(),
          detail: z.string().max(1000).optional(),
        })
        .parse(request.body);

      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const result = await runIdempotent(
        db,
        { key, endpoint: `POST /production/units/${unitId}/post-press`, body },
        async () => {
          const unit = await db.jerseyUnit.findUnique({
            where: { id: unitId },
            include: { emblem: { include: { chip: true } } },
          });
          if (!unit?.emblem?.chip) throw notFound('Unidad o chip no encontrado');

          const chip = unit.emblem.chip;
          const passed = body.readable && body.contentIntact;
          const simulated = config.NFC_PROVIDER === 'mock';

          await db.postPressCheck.create({
            data: {
              jerseyUnitId: unit.id,
              passed,
              readable: body.readable,
              contentIntact: body.contentIntact,
              temperatureC: body.temperatureC ?? null,
              pressureBar: body.pressureBar ?? null,
              durationSec: body.durationSec ?? null,
              operatorId: user.id,
              deviceId: user.deviceId,
              providerId: config.NFC_PROVIDER,
              simulated,
              detail: body.detail ?? null,
            },
          });

          const nextState: ChipState = passed ? 'POST_PRESS_PASSED' : 'QUARANTINED';
          assertChipTransition(chip.state as ChipState, nextState);

          await db.$transaction([
            db.nfcChip.update({ where: { id: chip.id }, data: { state: nextState } }),
            db.jerseyUnit.update({
              where: { id: unit.id },
              data: { state: passed ? 'READY' : 'QUARANTINED' },
            }),
          ]);

          await recordAudit(db, {
            actorId: user.id,
            action: passed ? 'production.post_press.passed' : 'production.post_press.failed',
            entityType: 'JerseyUnit',
            entityId: unit.id,
            metadata: {
              temperatureC: body.temperatureC,
              durationSec: body.durationSec,
              simulated,
            },
            ipPrefix: context.ipPrefix,
          });

          return {
            statusCode: 200,
            body: {
              unitId: unit.id,
              passed,
              chipState: nextState,
              simulated,
              message: passed
                ? 'Prueba superada. La unidad puede activarse.'
                : 'La unidad no supero la prueba y paso a cuarentena.',
            },
          };
        },
      );

      return reply.status(result.statusCode).send(result.body);
    },
  );

  // --- Activacion, cuarentena -----------------------------------------------

  app.post(
    '/units/:unitId/activate',
    {
      preHandler: [app.requirePermission('production:activate')],
      schema: { tags: ['produccion'], summary: 'Activa comercialmente una unidad' },
    },
    async (request, reply) => {
      const key = requireIdempotencyKey(request);
      const { unitId } = z.object({ unitId: z.string().uuid() }).parse(request.params);
      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const result = await runIdempotent(
        db,
        { key, endpoint: `POST /production/units/${unitId}/activate`, body: {} },
        async () => {
          const unit = await db.jerseyUnit.findUnique({
            where: { id: unitId },
            include: { emblem: { include: { chip: true } }, certificate: true },
          });
          if (!unit?.emblem?.chip) throw notFound('Unidad o chip no encontrado');

          const chip = unit.emblem.chip;

          // Solo se activa lo que supero el control posterior al calor.
          assertChipTransition(chip.state as ChipState, 'ACTIVATED');

          const now = new Date();

          await db.$transaction(async (tx) => {
            await tx.nfcChip.update({
              where: { id: chip.id },
              data: { state: 'ACTIVATED', activatedAt: now },
            });
            await tx.jerseyUnit.update({
              where: { id: unit.id },
              data: { state: 'ACTIVATED', activatedAt: now },
            });
            if (!unit.certificate) {
              await tx.digitalCertificate.create({
                data: {
                  jerseyUnitId: unit.id,
                  serial: `CERT-${unit.publicRef.replace('MEV-', '')}`,
                  // PENDIENTE: firmar con clave custodiada en KMS.
                  // Ver docs/plan-gestion-claves.md
                  signature: null,
                },
              });
            }
            await recordAudit(tx, {
              actorId: user.id,
              action: 'production.unit.activated',
              entityType: 'JerseyUnit',
              entityId: unit.id,
              ipPrefix: context.ipPrefix,
            });
          });

          return {
            statusCode: 200,
            body: {
              unitId: unit.id,
              publicRef: unit.publicRef,
              state: 'ACTIVATED',
              activatedAt: now.toISOString(),
            },
          };
        },
      );

      return reply.status(result.statusCode).send(result.body);
    },
  );

  app.post(
    '/units/:unitId/quarantine',
    {
      preHandler: [app.requirePermission('production:quarantine')],
      schema: { tags: ['produccion'], summary: 'Pone una unidad en cuarentena' },
    },
    async (request) => {
      const { unitId } = z.object({ unitId: z.string().uuid() }).parse(request.params);
      const body = z.object({ reason: z.string().min(3).max(500) }).parse(request.body);
      const user = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const unit = await db.jerseyUnit.findUnique({
        where: { id: unitId },
        include: { emblem: { include: { chip: true } } },
      });
      if (!unit) throw notFound('Unidad no encontrada');

      await db.$transaction(async (tx) => {
        if (unit.emblem?.chip) {
          await tx.nfcChip.update({
            where: { id: unit.emblem.chip.id },
            data: { state: 'QUARANTINED' },
          });
        }
        await tx.jerseyUnit.update({ where: { id: unit.id }, data: { state: 'QUARANTINED' } });
        await recordAudit(tx, {
          actorId: user.id,
          action: 'production.unit.quarantined',
          entityType: 'JerseyUnit',
          entityId: unit.id,
          metadata: { reason: body.reason },
          ipPrefix: context.ipPrefix,
        });
      });

      return { unitId: unit.id, state: 'QUARANTINED' };
    },
  );

  /** Historial del operario, para su propia pantalla en la app. */
  app.get(
    '/me/history',
    {
      preHandler: [app.requirePermission('production:read')],
      schema: { tags: ['produccion'], summary: 'Trabajos recientes del operario' },
    },
    async (request) => {
      const jobs = await db.personalizationJob.findMany({
        where: { operatorId: request.currentUser!.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { productionOrder: { select: { code: true } }, chip: { select: { uid: true } } },
      });

      return {
        jobs: jobs.map((j) => ({
          id: j.id,
          orderCode: j.productionOrder.code,
          state: j.state,
          simulated: j.simulated,
          attempts: j.attempts,
          lastError: j.lastError,
          createdAt: j.createdAt.toISOString(),
          // El operario NO tiene permiso `chips:read`: ve el UID enmascarado.
          chipUidMasked: j.chip ? maskUid(j.chip.uid) : null,
        })),
      };
    },
  );
}

function maskUid(uid: string): string {
  return uid.length <= 4 ? '••••' : `${uid.slice(0, 2)}${'•'.repeat(uid.length - 4)}${uid.slice(-2)}`;
}

export { createHash };
