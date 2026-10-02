import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  MockNfcProvider,
  createSimulatedTag,
  type PersonalizationPlan,
} from '@mev/nfc-contracts';
import {
  bearer,
  createTestApp,
  createUser,
  loginProduction,
  newIdempotencyKey,
  resetDatabase,
  seedBase,
  testDb,
  verify,
  type BaseFixtures,
} from './harness.js';

/**
 * Flujo de produccion de extremo a extremo.
 *
 * Recorre exactamente lo que hara el operario en planta: reservar, escribir,
 * releer, vincular, prensar, activar; y termina verificando la unidad desde la
 * web publica, que es la prueba de que la cadena completa encaja.
 *
 * La parte NFC se ejecuta con el proveedor SIMULADO: no hay hardware conectado
 * en este entorno. Eso queda marcado en el nombre de la prueba y en los datos.
 */

let app: FastifyInstance;
let db: PrismaClient;
let fixtures: BaseFixtures;
/** Token del operario de planta. NO tiene permiso para activar ni revocar. */
let token: string;
/**
 * Token de un rol con `production:activate`.
 *
 * La separacion es deliberada: el operario programa y vincula, pero la
 * activacion comercial (y la liberacion de una cuarentena) exige un rol
 * superior. Ver packages/domain/src/rbac.ts
 */
let supervisorToken: string;

const UID = '04A1B2C3D4E580';

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
  await createUser(db, { email: 'operario@test.local', role: 'PRODUCTION_OPERATOR' });
  await createUser(db, { email: 'jefe@test.local', role: 'MARATHON_ADMIN' });
  token = await loginProduction(app, 'operario@test.local', fixtures.deviceId);
  supervisorToken = await loginProduction(app, 'jefe@test.local', fixtures.deviceId);
});

async function reserve(uid = UID, chipType = 'NTAG213') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/production/jobs/reserve',
    headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('reserve') },
    payload: { orderId: fixtures.orderId, uid, chipType, batchCode: fixtures.batchCode },
  });
}

describe('flujo completo de produccion (proveedor NFC SIMULADO)', () => {
  it('recorre reserva, escritura, verificacion, vinculacion, prensa y activacion', async () => {
    // --- 1. Inspeccion previa: el chip es nuevo -----------------------------
    const inspect = await app.inject({
      method: 'POST',
      url: '/api/v1/production/chips/inspect',
      headers: bearer(token),
      payload: { uid: UID, chipType: 'NTAG213' },
    });
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json().known).toBe(false);
    expect(inspect.json().canProgram).toBe(true);

    // --- 2. Reserva ---------------------------------------------------------
    const reserved = await reserve();
    expect(reserved.statusCode).toBe(201);
    const plan = reserved.json();
    expect(plan.targetUri).toMatch(/^http:\/\/localhost:3000\/v\//);
    // El telefono NUNCA recibe material criptografico.
    expect(plan.keyReferences).toEqual([]);
    expect(plan.simulated).toBe(true);

    let chip = await db.nfcChip.findUnique({ where: { uid: UID } });
    expect(chip?.state).toBe('RESERVED');
    // La base de datos guarda el hash, no el token.
    expect(chip?.tagTokenHash).toBeTruthy();
    expect(plan.targetUri).not.toContain(chip!.tagTokenHash!);

    // --- 3. Escritura NDEF con el proveedor simulado ------------------------
    // Se ejecuta el proveedor de verdad sobre un tag simulado, para que la
    // prueba ejercite la codificacion NDEF real y no solo la API.
    const tag = createSimulatedTag(UID, 'NTAG213');
    const provider = new MockNfcProvider({ tag });
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    const personalizationPlan: PersonalizationPlan = {
      jobId: plan.jobId,
      uri: plan.targetUri,
      keyReferences: [],
      lockPlan: plan.lockPlan,
    };
    const write = await provider.writeNdef(inspection, personalizationPlan);
    expect(write.success).toBe(true);

    const written = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('written') },
      payload: { success: true, writtenPayloadHash: write.writtenPayloadHex.slice(0, 64) },
    });
    expect(written.statusCode).toBe(200);
    expect(written.json().state).toBe('WRITTEN');

    chip = await db.nfcChip.findUnique({ where: { uid: UID } });
    expect(chip?.state).toBe('PROGRAMMED');

    // --- 4. Relectura de comprobacion ---------------------------------------
    const readBack = await provider.verifyPersonalization(inspection, personalizationPlan, write);
    expect(readBack.matches).toBe(true);

    const verified = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/verified`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('verified') },
      payload: { matches: true, readBackUri: readBack.readBackUri },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().accepted).toBe(true);

    chip = await db.nfcChip.findUnique({ where: { uid: UID } });
    expect(chip?.state).toBe('VERIFIED');

    // --- 5. Vinculacion con el jersey ---------------------------------------
    const linked = await app.inject({
      method: 'POST',
      url: '/api/v1/production/units/link',
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('link') },
      payload: {
        jobId: plan.jobId,
        skuCode: fixtures.skuCode,
        emblemCode: 'EMB-FLOW-0001',
        playerId: fixtures.playerId,
        shirtNumber: 10,
      },
    });
    expect(linked.statusCode).toBe(201);
    const unit = linked.json();
    expect(unit.publicRef).toMatch(/^MEV-/);
    expect(unit.chipState).toBe('READY_FOR_HEAT_PRESS');
    // El QR de respaldo se entrega una sola vez, para imprimirlo.
    expect(unit.qrUrl).toMatch(/\/q\//);

    // --- 6. Control posterior al termosellado -------------------------------
    const postPress = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/post-press`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('postpress') },
      payload: {
        readable: true,
        contentIntact: true,
        temperatureC: 150,
        pressureBar: 3.5,
        durationSec: 15,
      },
    });
    expect(postPress.statusCode).toBe(200);
    expect(postPress.json().passed).toBe(true);
    // Debe quedar constancia de que fue una prueba SIMULADA, no fisica.
    expect(postPress.json().simulated).toBe(true);

    const check = await db.postPressCheck.findFirst({ where: { jerseyUnitId: unit.unitId } });
    expect(check?.simulated).toBe(true);
    expect(check?.temperatureC).toBe(150);

    // --- 7. Activacion ------------------------------------------------------
    // La activacion la realiza un rol con `production:activate`, no el operario.
    const activated = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(supervisorToken), 'idempotency-key': newIdempotencyKey('activate') },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().state).toBe('ACTIVATED');

    // El certificado se emite al activar.
    const certificate = await db.digitalCertificate.findUnique({
      where: { jerseyUnitId: unit.unitId },
    });
    expect(certificate).not.toBeNull();
    // Sin clave custodiada, el certificado no va firmado. Y se dice.
    expect(certificate?.signature).toBeNull();

    // --- 8. Verificacion desde la web publica -------------------------------
    // Se extrae el token de la URL, que es exactamente lo que haria el telefono
    // del aficionado al leer el chip.
    const tagToken = plan.targetUri.split('/v/')[1] as string;
    const { body: publicResult } = await verify(app, tagToken);

    expect(publicResult.trustLevel).toBe('IDENTIFIED_ONLY');
    expect(publicResult.unit.club).toBe('Club Prueba');
    expect(publicResult.unit.claimable).toBe(true);

    // --- 9. Auditoria de toda la cadena -------------------------------------
    const audit = await db.auditEvent.findMany({ orderBy: { createdAt: 'asc' } });
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('production.chip.reserved');
    expect(actions).toContain('production.chip.written');
    expect(actions).toContain('production.chip.verified');
    expect(actions).toContain('production.unit.linked');
    expect(actions).toContain('production.post_press.passed');
    expect(actions).toContain('production.unit.activated');
  });
});

describe('proteccion contra programar dos veces el mismo chip', () => {
  it('la inspeccion avisa de que un chip activado no debe reprogramarse', async () => {
    await db.nfcChip.create({ data: { uid: UID, chipType: 'NTAG213', state: 'ACTIVATED' } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/chips/inspect',
      headers: bearer(token),
      payload: { uid: UID, chipType: 'NTAG213' },
    });

    expect(response.json().known).toBe(true);
    expect(response.json().canProgram).toBe(false);
    expect(response.json().message).toContain('Apartelo');
  });

  it('la reserva de un chip ya activado se rechaza con 409', async () => {
    await db.nfcChip.create({ data: { uid: UID, chipType: 'NTAG213', state: 'ACTIVATED' } });

    const response = await reserve();
    expect(response.statusCode).toBe(409);
  });

  it('un chip revocado no puede reservarse', async () => {
    await db.nfcChip.create({ data: { uid: UID, chipType: 'NTAG213', state: 'REVOKED' } });
    expect((await reserve()).statusCode).toBe(409);
  });

  it('la inspeccion detecta que el tipo de chip no coincide con el registrado', async () => {
    await db.nfcChip.create({ data: { uid: UID, chipType: 'NTAG213', state: 'VALIDATED' } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/chips/inspect',
      headers: bearer(token),
      payload: { uid: UID, chipType: 'NTAG216' },
    });
    expect(response.json().typeMismatch).toBe(true);
  });

  it('reservar con un tipo distinto al registrado devuelve 409', async () => {
    await db.nfcChip.create({ data: { uid: UID, chipType: 'NTAG213', state: 'VALIDATED' } });
    const response = await reserve(UID, 'NTAG216');
    expect(response.statusCode).toBe(409);
  });
});

describe('idempotencia de las operaciones de produccion', () => {
  it('sin cabecera Idempotency-Key la reserva se rechaza', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: bearer(token),
      payload: { orderId: fixtures.orderId, uid: UID, chipType: 'NTAG213' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('repetir la reserva con la misma clave devuelve el MISMO trabajo', async () => {
    const key = newIdempotencyKey('repetida');
    const payload = { orderId: fixtures.orderId, uid: UID, chipType: 'NTAG213' };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: { ...bearer(token), 'idempotency-key': key },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: { ...bearer(token), 'idempotency-key': key },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().jobId).toBe(first.json().jobId);
    // Y el token grabado debe ser el mismo: si no, el chip fisico y el registro
    // se desincronizarian.
    expect(second.json().targetUri).toBe(first.json().targetUri);

    // Un solo trabajo en la base de datos, no dos.
    expect(await db.personalizationJob.count()).toBe(1);
  });

  it('la misma clave con un cuerpo distinto devuelve 409', async () => {
    const key = newIdempotencyKey('conflicto');

    await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: { ...bearer(token), 'idempotency-key': key },
      payload: { orderId: fixtures.orderId, uid: UID, chipType: 'NTAG213' },
    });

    const conflicting = await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: { ...bearer(token), 'idempotency-key': key },
      payload: { orderId: fixtures.orderId, uid: '04FFFFFFFFFF80', chipType: 'NTAG213' },
    });

    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('la misma clave en otro endpoint devuelve 409', async () => {
    const key = newIdempotencyKey('cruzada');

    const reserved = await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: { ...bearer(token), 'idempotency-key': key },
      payload: { orderId: fixtures.orderId, uid: UID, chipType: 'NTAG213' },
    });

    const reused = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${reserved.json().jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': key },
      payload: { success: true },
    });

    expect(reused.statusCode).toBe(409);
  });

  it('activar dos veces con la misma clave no duplica el certificado', async () => {
    const unit = await createActivatableUnit();
    const key = newIdempotencyKey('doble-activacion');

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(supervisorToken), 'idempotency-key': key },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(supervisorToken), 'idempotency-key': key },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await db.digitalCertificate.count()).toBe(1);
  });

  it('activar dos veces con claves DISTINTAS se rechaza por la maquina de estados', async () => {
    const unit = await createActivatableUnit();

    await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(supervisorToken), 'idempotency-key': newIdempotencyKey('a') },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(supervisorToken), 'idempotency-key': newIdempotencyKey('b') },
    });

    // ACTIVATED -> ACTIVATED no es una transicion declarada.
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('INVALID_STATE');
  });
});

describe('reintentos seguros', () => {
  it('un fallo de escritura permite reintentar sin perder el trabajo', async () => {
    const plan = (await reserve()).json();

    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('fallo') },
      payload: { success: false, errorCode: 'TAG_LOST' },
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json().canRetry).toBe(true);

    const job = await db.personalizationJob.findUnique({ where: { id: plan.jobId } });
    expect(job?.state).toBe('FAILED');
    expect(job?.attempts).toBe(1);

    // El chip sigue reservado: se puede reintentar sobre el mismo.
    const chip = await db.nfcChip.findUnique({ where: { uid: UID } });
    expect(chip?.state).toBe('RESERVED');

    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('reintento') },
      payload: { success: true, writtenPayloadHash: 'abc123' },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().state).toBe('WRITTEN');
  });
});

describe('la relectura discrepante manda la unidad a cuarentena', () => {
  it('si el cliente dice que no coincide, el chip pasa a QUARANTINED', async () => {
    const plan = (await reserve()).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('w') },
      payload: { success: true, writtenPayloadHash: 'abc' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/verified`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('v') },
      payload: { matches: false, readBackUri: null },
    });

    expect(response.json().accepted).toBe(false);
    expect(response.json().chipState).toBe('QUARANTINED');

    const chip = await db.nfcChip.findUnique({ where: { uid: UID } });
    expect(chip?.state).toBe('QUARANTINED');
  });

  it('si el cliente miente diciendo que coincide, el SERVIDOR lo detecta', async () => {
    const plan = (await reserve()).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('w2') },
      payload: { success: true, writtenPayloadHash: 'abc' },
    });

    // El cliente afirma exito pero la URL releida no es la que el servidor
    // ordeno grabar. El servidor compara contra `targetUri` y no se fia.
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/verified`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('v2') },
      payload: { matches: true, readBackUri: 'http://sitio-del-atacante.test/v/OTRO-TOKEN' },
    });

    expect(response.json().accepted).toBe(false);
    const job = await db.personalizationJob.findUnique({ where: { id: plan.jobId } });
    expect(job?.lastError).toBe('VERIFY_MISMATCH_SERVER');
  });
});

describe('la maquina de estados impide saltarse pasos', () => {
  it('no se puede vincular un chip que no supero la relectura', async () => {
    const plan = (await reserve()).json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/units/link',
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('salto') },
      payload: { jobId: plan.jobId, skuCode: fixtures.skuCode, emblemCode: 'EMB-SALTO' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_STATE');
  });

  it('no se puede activar sin pasar el control posterior al calor', async () => {
    const unit = await createLinkedUnit();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(supervisorToken), 'idempotency-key': newIdempotencyKey('sin-prensa') },
    });

    expect(response.statusCode).toBe(409);
  });

  it('el operario de planta NO puede activar una unidad', async () => {
    const unit = await createActivatableUnit();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('operario-activa') },
    });

    // Separacion de funciones: programar y activar son decisiones distintas.
    expect(response.statusCode).toBe(403);
  });

  it('una unidad que falla la prensa pasa a cuarentena y no se activa', async () => {
    const unit = await createLinkedUnit();

    const postPress = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/post-press`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('prensa-mala') },
      payload: { readable: false, contentIntact: false, temperatureC: 190 },
    });
    expect(postPress.json().passed).toBe(false);
    expect(postPress.json().chipState).toBe('QUARANTINED');

    // El operario NO puede sacar una unidad de cuarentena.
    const byOperator = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('operario-cuarentena') },
    });
    expect(byOperator.statusCode).toBe(403);

    let chip = await db.nfcChip.findFirst({ where: { uid: UID } });
    expect(chip?.state).toBe('QUARANTINED');

    // Un rol con `production:activate` SI puede liberarla: QUARANTINED ->
    // ACTIVATED es una transicion declarada, y representa justamente la
    // decision humana de rehabilitar la unidad tras revisarla.
    const bySupervisor = await app.inject({
      method: 'POST',
      url: `/api/v1/production/units/${unit.unitId}/activate`,
      headers: {
        ...bearer(supervisorToken),
        'idempotency-key': newIdempotencyKey('supervisor-libera'),
      },
    });
    expect(bySupervisor.statusCode).toBe(200);

    chip = await db.nfcChip.findFirst({ where: { uid: UID } });
    expect(chip?.state).toBe('ACTIVATED');
  });

  it('un emblema ya vinculado no puede reutilizarse en otra unidad', async () => {
    await createLinkedUnit('EMB-UNICO');

    const plan = (await reserve('04FFEEDDCCBB80')).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('w3') },
      payload: { success: true, writtenPayloadHash: 'x' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/verified`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('v3') },
      payload: { matches: true, readBackUri: plan.targetUri },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/units/link',
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('emblema-repetido') },
      payload: { jobId: plan.jobId, skuCode: fixtures.skuCode, emblemCode: 'EMB-UNICO' },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('validaciones de entrada de produccion', () => {
  it('rechaza un UID que no es hexadecimal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/jobs/reserve',
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('uid-malo') },
      payload: { orderId: fixtures.orderId, uid: 'ZZZZZZZZ', chipType: 'NTAG213' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rechaza una orden cancelada', async () => {
    await db.productionOrder.update({
      where: { id: fixtures.orderId },
      data: { state: 'CANCELLED' },
    });
    const response = await reserve();
    expect(response.statusCode).toBe(409);
  });

  it('rechaza NTAG 424 DNA porque el adaptador no esta implementado', async () => {
    const response = await reserve('04424242424280', 'NTAG424DNA');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('NTAG 424 DNA');
  });

  it('rechaza un SKU inexistente al vincular', async () => {
    const plan = (await reserve()).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('w4') },
      payload: { success: true, writtenPayloadHash: 'x' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/verified`,
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('v4') },
      payload: { matches: true, readBackUri: plan.targetUri },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/units/link',
      headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('sku-malo') },
      payload: { jobId: plan.jobId, skuCode: 'SKU-QUE-NO-EXISTE', emblemCode: 'EMB-X' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('un operario no puede tocar el trabajo de otro operario', async () => {
    const plan = (await reserve()).json();

    await createUser(db, { email: 'otro-operario@test.local', role: 'PRODUCTION_OPERATOR' });
    const otherToken = await loginProduction(app, 'otro-operario@test.local', fixtures.deviceId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/production/jobs/${plan.jobId}/written`,
      headers: { ...bearer(otherToken), 'idempotency-key': newIdempotencyKey('ajeno') },
      payload: { success: true, writtenPayloadHash: 'x' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('historial del operario', () => {
  it('muestra el UID enmascarado, nunca el completo', async () => {
    await reserve();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/production/me/history',
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const job = response.json().jobs[0];
    expect(job.chipUidMasked).not.toBe(UID);
    expect(job.chipUidMasked).toContain('•');
    expect(response.body).not.toContain(UID);
  });

  it('marca los trabajos hechos con el proveedor simulado', async () => {
    await reserve();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/production/me/history',
      headers: bearer(token),
    });
    expect(response.json().jobs[0].simulated).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/** Lleva una unidad hasta LINKED / READY_FOR_HEAT_PRESS. */
async function createLinkedUnit(emblemCode = 'EMB-HELPER'): Promise<{ unitId: string }> {
  const plan = (await reserve()).json();
  await app.inject({
    method: 'POST',
    url: `/api/v1/production/jobs/${plan.jobId}/written`,
    headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('h-w') },
    payload: { success: true, writtenPayloadHash: 'x' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/production/jobs/${plan.jobId}/verified`,
    headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('h-v') },
    payload: { matches: true, readBackUri: plan.targetUri },
  });
  const linked = await app.inject({
    method: 'POST',
    url: '/api/v1/production/units/link',
    headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('h-l') },
    payload: { jobId: plan.jobId, skuCode: fixtures.skuCode, emblemCode },
  });
  return { unitId: linked.json().unitId };
}

/** Lleva una unidad hasta POST_PRESS_PASSED, lista para activar. */
async function createActivatableUnit(): Promise<{ unitId: string }> {
  const unit = await createLinkedUnit('EMB-ACTIVABLE');
  await app.inject({
    method: 'POST',
    url: `/api/v1/production/units/${unit.unitId}/post-press`,
    headers: { ...bearer(token), 'idempotency-key': newIdempotencyKey('h-p') },
    payload: { readable: true, contentIntact: true, temperatureC: 150, durationSec: 15 },
  });
  return unit;
}
