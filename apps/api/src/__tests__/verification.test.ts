import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  createTestApp,
  resetDatabase,
  seedActivatedUnit,
  seedBase,
  testDb,
  verify,
  type BaseFixtures,
} from './harness.js';

/**
 * Pruebas de la ruta publica de verificacion.
 *
 * Es el endpoint mas expuesto del sistema: cualquiera con un telefono lo invoca.
 * Estas pruebas cubren los seis niveles de confianza, lo que NO debe filtrarse
 * y la resistencia a enumeracion y replay.
 */

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

describe('niveles de confianza', () => {
  it('una unidad activada leida por NDEF devuelve IDENTIFIED_ONLY', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const { status, body } = await verify(app, unit.tagToken);

    expect(status).toBe(200);
    expect(body.trustLevel).toBe('IDENTIFIED_ONLY');
    expect(body.unit.club).toBe('Club Prueba');
    expect(body.unit.shirtNumber).toBe(10);
  });

  it('un QR nunca supera IDENTIFIED_ONLY', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const { body } = await verify(app, unit.qrToken, 'QR_CODE');

    expect(body.trustLevel).toBe('IDENTIFIED_ONLY');
    // Debe sugerir usar NFC para una comprobacion mas fuerte.
    expect(body.actions).toContain('SUGGEST_RETRY_NFC');
  });

  it('una unidad revocada devuelve REVOKED y no entrega la ficha del producto', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'REVOKED',
      unitState: 'REVOKED',
    });
    const { body } = await verify(app, unit.tagToken);

    expect(body.trustLevel).toBe('REVOKED');
    // Sin ficha: quien roba emblemas no debe poder averiguar a que modelo van.
    expect(body.unit).toBeNull();
    expect(body.actions).toContain('BLOCK_REWARDS');
  });

  it('una unidad aun en produccion devuelve NOT_ACTIVATED sin ficha', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'READY_FOR_HEAT_PRESS',
      unitState: 'IN_PRODUCTION',
    });
    const { body } = await verify(app, unit.tagToken);

    expect(body.trustLevel).toBe('NOT_ACTIVATED');
    expect(body.unit).toBeNull();
  });

  it('una unidad en cuarentena devuelve SUSPICIOUS', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'QUARANTINED',
      unitState: 'QUARANTINED',
    });
    const { body } = await verify(app, unit.tagToken);

    expect(body.trustLevel).toBe('SUSPICIOUS');
    expect(body.message.explicacion).toContain('no significa que su jersey sea falso');
  });

  it('un token desconocido devuelve UNVERIFIABLE', async () => {
    const { status, body } = await verify(app, 'token-que-no-existe-en-absoluto-1234');

    expect(status).toBe(200);
    expect(body.trustLevel).toBe('UNVERIFIABLE');
    expect(body.unit).toBeNull();
    expect(body.maskedRef).toBeNull();
  });
});

describe('el cliente no puede fabricar una verificacion criptografica', () => {
  it('declarar NFC_CRYPTOGRAPHIC con un mensaje inventado NO produce VERIFIED', async () => {
    const unit = await seedActivatedUnit(db, fixtures, { chipType: 'NTAG424DNA' });

    const { body } = await verify(app, unit.tagToken, 'NFC_CRYPTOGRAPHIC', {
      authenticatedMessage: 'DEADBEEFCAFEBABE',
      reportedCounter: 500,
    });

    // Es la invariante central del sistema: la firma se valida en servidor y
    // hoy no hay verificador, asi que nadie alcanza VERIFIED.
    expect(body.trustLevel).not.toBe('VERIFIED');
    expect(body.trustLevel).toBe('IDENTIFIED_ONLY');
  });

  it('el contador declarado por el cliente no se acepta si la lectura no es VERIFIED', async () => {
    const unit = await seedActivatedUnit(db, fixtures, { chipType: 'NTAG424DNA' });

    await verify(app, unit.tagToken, 'NFC_CRYPTOGRAPHIC', {
      authenticatedMessage: 'AA',
      reportedCounter: 999_999,
    });

    const chip = await db.nfcChip.findUnique({ where: { id: unit.chipId } });
    // Si se aceptara, un atacante podria empujar el contador y bloquear al
    // chip legitimo (denegacion de servicio contra el propio jersey).
    expect(chip?.lastAcceptedCounter).toBeNull();
  });
});

describe('lo que NUNCA debe salir en la respuesta', () => {
  it('no expone el UID del chip', async () => {
    const unit = await seedActivatedUnit(db, fixtures, { uid: '04AABBCCDDEE80' });
    const { body } = await verify(app, unit.tagToken);

    expect(JSON.stringify(body)).not.toContain('04AABBCCDDEE80');
  });

  it('no expone el token presentado ni su hash', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const { body } = await verify(app, unit.tagToken);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(unit.tagToken);
    expect(serialized).not.toContain('tokenHash');
  });

  it('no expone la referencia publica completa, solo enmascarada', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const { body } = await verify(app, unit.tagToken);

    expect(body.maskedRef).not.toBe(unit.publicRef);
    expect(body.maskedRef).toContain('•');
  });

  it('no expone codigos de razon internos al aficionado', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'QUARANTINED',
      unitState: 'QUARANTINED',
    });
    const { body } = await verify(app, unit.tagToken);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('CHIP_IN_QUARANTINE');
    expect(serialized).not.toContain('reasonCodes');
    expect(serialized).not.toContain('riskScore');
  });

  it('no expone acciones internas del motor de riesgo', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'QUARANTINED',
      unitState: 'QUARANTINED',
    });
    const { body } = await verify(app, unit.tagToken);

    expect(body.actions).not.toContain('OPEN_RISK_ALERT');
    expect(body.actions).not.toContain('REQUIRE_HUMAN_REVIEW');
  });

  it('el token del QR no permite deducir el token del NFC', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    // Espacios de identificadores independientes: uno no deriva del otro.
    expect(unit.qrToken).not.toBe(unit.tagToken);
    expect(unit.tagToken.startsWith(unit.qrToken)).toBe(false);
  });
});

describe('trazabilidad de las lecturas', () => {
  it('registra un evento incluso cuando el token es desconocido', async () => {
    await verify(app, 'token-inexistente-para-auditoria-99');

    const events = await db.verificationEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]!.trustLevel).toBe('UNVERIFIABLE');
    expect(events[0]!.jerseyUnitId).toBeNull();
  });

  it('nunca guarda la IP completa, solo un seudonimo', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken, 'NFC_STATIC_URL', {}, { 'x-forwarded-for': '186.101.55.77' });

    const event = await db.verificationEvent.findFirst();
    expect(event?.ipPseudonym).toBeTruthy();
    expect(event?.ipPseudonym).not.toContain('186.101.55.77');
    expect(event?.ipPseudonym).not.toContain('186.101.55');
  });

  it('incrementa el contador de interacciones de la unidad', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);
    await verify(app, unit.tagToken);

    const updated = await db.jerseyUnit.findUnique({ where: { id: unit.unitId } });
    expect(updated?.interactionCount).toBe(2);
  });

  it('marca el evento como simulado cuando el proveedor es el simulador', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const { body } = await verify(app, unit.tagToken);

    expect(body.simulated).toBe(true);
    const event = await db.verificationEvent.findFirst();
    expect(event?.simulated).toBe(true);
  });
});

describe('deteccion de replay', () => {
  it('detecta la reutilizacion del mismo mensaje autenticado', async () => {
    const unit = await seedActivatedUnit(db, fixtures, { chipType: 'NTAG424DNA' });

    await verify(app, unit.tagToken, 'NFC_CRYPTOGRAPHIC', { authenticatedMessage: 'MENSAJE-A' });
    await verify(app, unit.tagToken, 'NFC_CRYPTOGRAPHIC', { authenticatedMessage: 'MENSAJE-A' });

    const events = await db.verificationEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(2);
    // Ambos eventos comparten huella: es asi como se detecta el replay.
    expect(events[0]!.messageFingerprint).toBe(events[1]!.messageFingerprint);
    expect(events[0]!.messageFingerprint).not.toContain('MENSAJE-A');
  });

  it('no almacena el mensaje autenticado en claro', async () => {
    const unit = await seedActivatedUnit(db, fixtures, { chipType: 'NTAG424DNA' });
    await verify(app, unit.tagToken, 'NFC_CRYPTOGRAPHIC', {
      authenticatedMessage: 'SECRETO-EN-CLARO',
    });

    const event = await db.verificationEvent.findFirst();
    expect(event?.messageFingerprint).not.toContain('SECRETO-EN-CLARO');
  });
});

describe('alertas de riesgo', () => {
  it('abre una alerta cuando la lectura es sospechosa', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'QUARANTINED',
      unitState: 'QUARANTINED',
    });
    await verify(app, unit.tagToken);

    const alerts = await db.riskAlert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.state).toBe('OPEN');
    expect(alerts[0]!.reasonCodes).toContain('CHIP_IN_QUARANTINE');
  });

  it('no inunda la bandeja: lecturas repetidas no duplican la alerta', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'QUARANTINED',
      unitState: 'QUARANTINED',
    });

    for (let i = 0; i < 5; i += 1) await verify(app, unit.tagToken);

    expect(await db.riskAlert.count()).toBe(1);
  });

  it('una unidad normal no genera alertas', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    await verify(app, unit.tagToken);

    expect(await db.riskAlert.count()).toBe(0);
  });

  it('una lectura previa a la venta NO genera alerta pero si queda registrada', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'READY_FOR_HEAT_PRESS',
      unitState: 'IN_PRODUCTION',
    });
    await verify(app, unit.tagToken);

    // Es normal durante el control de calidad interno: no debe alertar.
    expect(await db.riskAlert.count()).toBe(0);
    const event = await db.verificationEvent.findFirst();
    expect(event?.reasonCodes).toContain('READ_BEFORE_PRODUCTION_COMPLETE');
  });
});

describe('resistencia a enumeracion', () => {
  it('todos los tokens desconocidos producen la misma respuesta', async () => {
    const a = await verify(app, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const b = await verify(app, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    expect(a.body.trustLevel).toBe(b.body.trustLevel);
    expect(a.body.message).toEqual(b.body.message);
    expect(a.body.unit).toEqual(b.body.unit);
  });

  it('rechaza tokens demasiado cortos sin consultar la base de datos', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/verify',
      payload: { method: 'NFC_STATIC_URL', token: 'abc' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rechaza un metodo de verificacion no reconocido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/verify',
      payload: { method: 'INVENTADO', token: 'token-suficientemente-largo' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('el certificado de una unidad no activada devuelve 404', async () => {
    const unit = await seedActivatedUnit(db, fixtures, {
      chipState: 'READY_FOR_HEAT_PRESS',
      unitState: 'IN_PRODUCTION',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/units/${unit.unitId}/certificate`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('el certificado exige un identificador con formato UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/units/no-es-un-uuid/certificate',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('certificado digital', () => {
  it('se emite para una unidad activada y advierte su alcance', async () => {
    const unit = await seedActivatedUnit(db, fixtures);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/units/${unit.unitId}/certificate`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.club).toBe('Club Prueba');
    expect(body.maskedRef).toContain('•');
    // El certificado NO debe presentarse como prueba de autenticidad.
    expect(body.disclaimer).toContain('nivel de confianza');
  });
});
