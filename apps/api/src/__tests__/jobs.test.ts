import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { MIN_AGGREGATE_COHORT_SIZE } from '@mev/domain';
import {
  agregarAnaliticaDiaria,
  aplicarRetencion,
  caducarTransferencias,
  ejecutarTodos,
  limpiarCaducados,
  marcarLotesAnomalos,
  materializarMetricasDeCampana,
} from '../jobs/index.js';
import {
  createFan,
  createTestApp,
  resetDatabase,
  seedActivatedUnit,
  seedBase,
  testDb,
  verify,
  type BaseFixtures,
} from './harness.js';

let app: FastifyInstance;
let db: PrismaClient;
let fixtures: BaseFixtures;

beforeAll(async () => {
  db = testDb();
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(db);
  fixtures = await seedBase(db);
});

describe('agregacion de analitica diaria', () => {
  it('convierte eventos individuales en conteos sin sujeto', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);
    await verify(app, unit.tagToken);
    await verify(app, unit.qrToken, 'QR_CODE');

    const resultado = await agregarAnaliticaDiaria(db, new Date());
    expect(resultado.afectados).toBeGreaterThan(0);

    const filas = await db.analyticsDaily.findMany();
    const nfc = filas.find((f) => f.event === 'NFC_OPENED');
    const qr = filas.find((f) => f.event === 'QR_OPENED');

    expect(nfc?.count).toBe(2);
    expect(qr?.count).toBe(1);

    // Ninguna fila agregada puede llevar un identificador de persona o dispositivo.
    const serializado = JSON.stringify(filas);
    expect(serializado).not.toContain('ipPseudonym');
    expect(serializado).not.toContain('deviceFingerprint');
  });

  it('es idempotente: ejecutarla dos veces no duplica conteos', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);

    await agregarAnaliticaDiaria(db, new Date());
    await agregarAnaliticaDiaria(db, new Date());

    const filas = await db.analyticsDaily.findMany({ where: { event: 'NFC_OPENED' } });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.count).toBe(1);
  });
});

describe('metricas materializadas de campana', () => {
  async function crearCampana() {
    const sponsor = await db.sponsor.create({
      data: { organizationId: fixtures.organizationId, name: 'Patrocinador de prueba' },
    });
    return db.campaign.create({
      data: {
        sponsorId: sponsor.id,
        name: 'Campana de prueba',
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  it('marca como suprimida una metrica con cohorte pequena', async () => {
    const campana = await crearCampana();
    const reward = await db.reward.create({
      data: { campaignId: campana.id, name: 'Premio', minTrustLevel: 'IDENTIFIED_ONLY' },
    });
    const unit = await seedActivatedUnit(db, fixtures);
    const fan = await createFan(db, 'canjeador@test.local');
    await db.rewardRedemption.create({
      data: { rewardId: reward.id, fanId: fan.id, jerseyUnitId: unit.unitId },
    });

    await materializarMetricasDeCampana(db, new Date());

    const metrica = await db.campaignMetric.findFirst({
      where: { campaignId: campana.id, metricKey: 'campaign_reward_redemptions' },
    });

    expect(metrica?.value).toBe(1);
    // 1 canje esta muy por debajo del minimo: la fila nace marcada como
    // suprimida, no se decide al leerla.
    expect(metrica?.suppressed).toBe(true);
    expect(MIN_AGGREGATE_COHORT_SIZE).toBeGreaterThan(1);
  });

  it('es idempotente sobre el mismo dia', async () => {
    const campana = await crearCampana();

    await materializarMetricasDeCampana(db, new Date());
    await materializarMetricasDeCampana(db, new Date());

    const metricas = await db.campaignMetric.findMany({
      where: { campaignId: campana.id, metricKey: 'campaign_reward_redemptions' },
    });
    expect(metricas).toHaveLength(1);
  });
});

describe('politica de retencion', () => {
  it('anonimiza el detalle tecnico de los eventos antiguos y conserva el agregado', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);

    // Se envejece el evento mas alla de la ventana de retencion.
    await db.verificationEvent.updateMany({
      data: { createdAt: new Date(Date.now() - 400 * 86_400_000) },
    });

    const antes = await db.verificationEvent.findFirst();
    expect(antes?.ipPseudonym).toBeTruthy();

    const resultado = await aplicarRetencion(db);
    expect(resultado.afectados).toBe(1);

    const despues = await db.verificationEvent.findFirst();
    // El detalle tecnico desaparece...
    expect(despues?.ipPseudonym).toBeNull();
    expect(despues?.deviceFingerprint).toBeNull();
    // ...pero la fila y su valor estadistico se conservan.
    expect(despues?.trustLevel).toBe('IDENTIFIED_ONLY');
  });

  it('no toca los eventos dentro de la ventana de retencion', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);

    const resultado = await aplicarRetencion(db);
    expect(resultado.afectados).toBe(0);

    const evento = await db.verificationEvent.findFirst();
    expect(evento?.ipPseudonym).toBeTruthy();
  });
});

describe('caducidad de transferencias', () => {
  it('marca como caducadas las invitaciones vencidas', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const fan = await createFan(db, 'titular@test.local');

    await db.ownershipTransfer.create({
      data: {
        jerseyUnitId: unit.unitId,
        fromFanId: fan.id,
        toEmail: 'destino@test.local',
        tokenHash: 'hash-de-prueba-caducado',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const resultado = await caducarTransferencias(db);
    expect(resultado.afectados).toBe(1);

    const transferencia = await db.ownershipTransfer.findFirst();
    expect(transferencia?.state).toBe('EXPIRED');
  });

  it('no toca invitaciones vigentes', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const fan = await createFan(db, 'titular2@test.local');

    await db.ownershipTransfer.create({
      data: {
        jerseyUnitId: unit.unitId,
        fromFanId: fan.id,
        tokenHash: 'hash-vigente',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    expect((await caducarTransferencias(db)).afectados).toBe(0);
  });
});

describe('deteccion de lotes anomalos', () => {
  it('no marca un lote pequeno aunque tenga alertas', async () => {
    const lote = await db.productionBatch.create({ data: { code: 'LOTE-PEQUENO' } });
    const unit = await seedActivatedUnit(db, fixtures);
    await db.nfcChip.update({ where: { id: unit.chipId }, data: { batchId: lote.id } });
    await db.riskAlert.create({
      data: { jerseyUnitId: unit.unitId, riskLevel: 'HIGH', reasonCodes: 'X', summary: 'prueba' },
    });

    // Con un solo chip no hay base estadistica: marcar seria ruido.
    expect((await marcarLotesAnomalos(db)).afectados).toBe(0);
  });

  it('marca un lote cuando la proporcion de alertas supera el umbral', async () => {
    const lote = await db.productionBatch.create({ data: { code: 'LOTE-GRANDE' } });

    // 20 chips en el lote, 5 con alerta: 25%, por encima del 10%.
    for (let i = 0; i < 20; i += 1) {
      const unit = await seedActivatedUnit(db, fixtures, {
        uid: `04AA${i.toString(16).padStart(10, '0').toUpperCase()}`,
        emblemCode: `EMB-LOTE-${i}`,
      });
      await db.nfcChip.update({ where: { id: unit.chipId }, data: { batchId: lote.id } });
      if (i < 5) {
        await db.riskAlert.create({
          data: {
            jerseyUnitId: unit.unitId,
            riskLevel: 'HIGH',
            reasonCodes: 'X',
            summary: 'prueba',
          },
        });
      }
    }

    expect((await marcarLotesAnomalos(db)).afectados).toBe(1);

    const actualizado = await db.productionBatch.findUnique({ where: { id: lote.id } });
    expect(actualizado?.flagged).toBe(true);
    // El motivo debe dejar claro que exige revision humana, no que sean falsos.
    expect(actualizado?.flagReason).toContain('revision humana');
  });
});

describe('limpieza de caducados', () => {
  it('borra registros de idempotencia vencidos', async () => {
    await db.idempotencyRecord.create({
      data: {
        key: 'clave-vieja',
        endpoint: 'POST /x',
        requestHash: 'h',
        statusCode: 200,
        responseBody: {},
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await db.idempotencyRecord.create({
      data: {
        key: 'clave-vigente',
        endpoint: 'POST /x',
        requestHash: 'h',
        statusCode: 200,
        responseBody: {},
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const resultado = await limpiarCaducados(db);
    expect(resultado.afectados).toBe(1);
    expect(await db.idempotencyRecord.count()).toBe(1);
  });
});

describe('ejecucion completa', () => {
  it('ejecuta todos los trabajos sin fallar sobre una base con datos', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);

    const resultados = await ejecutarTodos(db, new Date());

    expect(resultados).toHaveLength(6);
    for (const r of resultados) {
      expect(r.trabajo).toBeTruthy();
      expect(typeof r.afectados).toBe('number');
    }
  });

  it('ejecuta todos los trabajos sin fallar sobre una base vacia', async () => {
    const resultados = await ejecutarTodos(db, new Date());
    expect(resultados.every((r) => r.afectados >= 0)).toBe(true);
  });
});
