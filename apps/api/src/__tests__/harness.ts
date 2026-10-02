import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import {
  generateQrToken,
  generateTagToken,
  generateUnitPublicRef,
  hashToken,
  type Role,
} from '@mev/domain';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

/** Utilidades compartidas por las pruebas de integracion. */

export const TEST_PASSWORD = 'PruebaSegura2026!';
export const PEPPER = 'test-token-pepper-0123456789abcdefghijklmnop';

let cachedHash: string | null = null;

async function passwordHash(): Promise<string> {
  // Argon2 es lento a proposito. Se calcula una sola vez por proceso de pruebas.
  cachedHash ??= await argon2.hash(TEST_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  return cachedHash;
}

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp(loadConfig());
  await app.ready();
  return app;
}

export function testDb(): PrismaClient {
  return new PrismaClient();
}

/** Vacia la base de datos en orden inverso de dependencias. */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$transaction([
    db.auditEvent.deleteMany(),
    db.idempotencyRecord.deleteMany(),
    db.analyticsDaily.deleteMany(),
    db.riskAlert.deleteMany(),
    db.verificationEvent.deleteMany(),
    db.postPressCheck.deleteMany(),
    db.rewardRedemption.deleteMany(),
    db.reward.deleteMany(),
    db.campaignMetric.deleteMany(),
    db.contentRule.deleteMany(),
    db.contentItem.deleteMany(),
    db.campaign.deleteMany(),
    db.sponsor.deleteMany(),
    db.supportCase.deleteMany(),
    db.privacyRequest.deleteMany(),
    db.consent.deleteMany(),
    db.fanSession.deleteMany(),
    db.ownershipTransfer.deleteMany(),
    db.ownership.deleteMany(),
    db.fanAccount.deleteMany(),
    db.digitalCertificate.deleteMany(),
    db.personalizationJob.deleteMany(),
    db.jerseyUnit.deleteMany(),
    db.emblem.deleteMany(),
    db.nfcKeyReference.deleteMany(),
    db.nfcChip.deleteMany(),
    db.productionBatch.deleteMany(),
    db.productionOrder.deleteMany(),
    db.userSession.deleteMany(),
    db.authorizedDevice.deleteMany(),
    db.programmingStation.deleteMany(),
    db.roleAssignment.deleteMany(),
    db.user.deleteMany(),
    db.match.deleteMany(),
    db.sku.deleteMany(),
    db.jerseyModel.deleteMany(),
    db.player.deleteMany(),
    db.season.deleteMany(),
    db.club.deleteMany(),
    db.organization.deleteMany(),
  ]);
}

export interface BaseFixtures {
  organizationId: string;
  clubId: string;
  seasonId: string;
  jerseyModelId: string;
  skuCode: string;
  playerId: string;
  orderId: string;
  orderCode: string;
  batchId: string;
  batchCode: string;
  deviceId: string;
  stationId: string;
}

/** Catalogo minimo necesario para ejercitar el flujo de produccion. */
export async function seedBase(db: PrismaClient): Promise<BaseFixtures> {
  const organization = await db.organization.create({
    data: { name: 'Marathon Pruebas', country: 'EC' },
  });
  const club = await db.club.create({
    data: { organizationId: organization.id, name: 'Club Prueba', slug: 'club-prueba' },
  });
  const season = await db.season.create({
    data: {
      clubId: club.id,
      name: 'Temporada Prueba',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  const player = await db.player.create({
    data: { clubId: club.id, seasonId: season.id, fullName: 'Jugador Prueba', shirtNumber: 10 },
  });
  const model = await db.jerseyModel.create({
    data: { clubId: club.id, seasonId: season.id, name: 'Local Prueba', edition: 'HOME' },
  });
  const sku = await db.sku.create({
    data: { jerseyModelId: model.id, code: 'TEST-SKU-M', size: 'M', priceCents: 4990 },
  });
  const order = await db.productionOrder.create({
    data: {
      organizationId: organization.id,
      code: 'OP-TEST-0001',
      state: 'OPEN',
      plannedUnits: 100,
    },
  });
  const batch = await db.productionBatch.create({
    data: { productionOrderId: order.id, code: 'LOTE-TEST-A' },
  });
  const station = await db.programmingStation.create({
    data: { code: 'EST-TEST', name: 'Puesto de prueba' },
  });
  const device = await db.authorizedDevice.create({
    data: { deviceId: 'test-device-0001', label: 'Telefono de prueba', stationId: station.id },
  });

  return {
    organizationId: organization.id,
    clubId: club.id,
    seasonId: season.id,
    jerseyModelId: model.id,
    skuCode: sku.code,
    playerId: player.id,
    orderId: order.id,
    orderCode: order.code,
    batchId: batch.id,
    batchCode: batch.code,
    deviceId: device.deviceId,
    stationId: station.id,
  };
}

/** Crea un usuario interno con un rol y alcance concretos. */
export async function createUser(
  db: PrismaClient,
  params: {
    email: string;
    role: Role;
    scopeType?: 'GLOBAL' | 'ORGANIZATION' | 'CLUB' | 'CAMPAIGN';
    scopeId?: string | null;
  },
): Promise<{ id: string; email: string }> {
  const user = await db.user.create({
    data: {
      email: params.email,
      displayName: params.email.split('@')[0]!,
      passwordHash: await passwordHash(),
      roleAssignments: {
        create: {
          role: params.role,
          scopeType: params.scopeType ?? 'GLOBAL',
          scopeId: params.scopeId ?? null,
        },
      },
    },
    select: { id: true, email: true },
  });
  return user;
}

export async function createFan(
  db: PrismaClient,
  email: string,
): Promise<{ id: string; email: string }> {
  return db.fanAccount.create({
    data: {
      email,
      passwordHash: await passwordHash(),
      displayName: email.split('@')[0]!,
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });
}

/** Inicia sesion en el panel y devuelve el token. */
export async function loginAdmin(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/login',
    payload: { email, password: TEST_PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login admin fallo (${response.statusCode}): ${response.body}`);
  }
  return response.json().token as string;
}

/** Inicia sesion desde la app de produccion (exige dispositivo autorizado). */
export async function loginProduction(
  app: FastifyInstance,
  email: string,
  deviceId: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/production/auth/login',
    payload: { email, password: TEST_PASSWORD, deviceId },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login produccion fallo (${response.statusCode}): ${response.body}`);
  }
  return response.json().token as string;
}

export async function loginFan(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/fan/login',
    payload: { email, password: TEST_PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login aficionado fallo (${response.statusCode}): ${response.body}`);
  }
  return response.json().token as string;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

let idempotencyCounter = 0;
/** Clave de idempotencia unica y legible, para poder rastrearla en un fallo. */
export function newIdempotencyKey(label = 'test'): string {
  idempotencyCounter += 1;
  return `${label}-${process.pid}-${idempotencyCounter}-${Date.now()}`;
}

export interface ActivatedUnit {
  unitId: string;
  publicRef: string;
  chipId: string;
  tagToken: string;
  qrToken: string;
}

/**
 * Crea directamente en la base de datos una unidad ya activada.
 *
 * Se usa en las pruebas que estudian la VERIFICACION, para no repetir el flujo
 * completo de produccion en cada una. El flujo de produccion tiene su propia
 * prueba de extremo a extremo que no toma este atajo.
 */
export async function seedActivatedUnit(
  db: PrismaClient,
  fixtures: BaseFixtures,
  overrides: {
    uid?: string;
    emblemCode?: string;
    chipState?: 'ACTIVATED' | 'QUARANTINED' | 'REVOKED' | 'READY_FOR_HEAT_PRESS';
    unitState?: 'ACTIVATED' | 'SOLD' | 'QUARANTINED' | 'REVOKED' | 'IN_PRODUCTION';
    chipType?: 'NTAG213' | 'NTAG424DNA';
    batchFlagged?: boolean;
  } = {},
): Promise<ActivatedUnit> {
  const tagToken = generateTagToken();
  const qrToken = generateQrToken();
  const uid = overrides.uid ?? `04${Math.random().toString(16).slice(2, 14).toUpperCase()}`;
  const now = new Date();

  const batchId = overrides.batchFlagged
    ? (
        await db.productionBatch.create({
          data: {
            code: `LOTE-FLAG-${Math.random().toString(36).slice(2, 8)}`,
            flagged: true,
            flagReason: 'Prueba',
          },
        })
      ).id
    : fixtures.batchId;

  const chip = await db.nfcChip.create({
    data: {
      uid,
      chipType: overrides.chipType ?? 'NTAG213',
      state: overrides.chipState ?? 'ACTIVATED',
      batchId,
      tagTokenHash: hashToken(tagToken, PEPPER),
      activatedAt: now,
    },
  });

  const emblem = await db.emblem.create({
    data: {
      code: overrides.emblemCode ?? `EMB-${Math.random().toString(36).slice(2, 10)}`,
      chipId: chip.id,
      batchId,
    },
  });

  const publicRef = generateUnitPublicRef();

  const unit = await db.jerseyUnit.create({
    data: {
      jerseyModelId: fixtures.jerseyModelId,
      playerId: fixtures.playerId,
      shirtNumber: 10,
      emblemId: emblem.id,
      productionOrderId: fixtures.orderId,
      publicRef,
      qrTokenHash: hashToken(qrToken, PEPPER),
      state: overrides.unitState ?? 'ACTIVATED',
      activatedAt: now,
    },
  });

  await db.digitalCertificate.create({
    data: { jerseyUnitId: unit.id, serial: `CERT-${publicRef.replace('MEV-', '')}` },
  });

  return { unitId: unit.id, publicRef, chipId: chip.id, tagToken, qrToken };
}

/** Atajo: verifica un token y devuelve el cuerpo de la respuesta. */
export async function verify(
  app: FastifyInstance,
  token: string,
  method: 'NFC_STATIC_URL' | 'QR_CODE' | 'NFC_CRYPTOGRAPHIC' = 'NFC_STATIC_URL',
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/verify',
    payload: { method, token, ...extra },
    headers,
  });
  return { status: response.statusCode, body: response.json() };
}
