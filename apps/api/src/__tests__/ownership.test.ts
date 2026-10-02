import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  bearer,
  createFan,
  createTestApp,
  loginFan,
  resetDatabase,
  seedActivatedUnit,
  seedBase,
  testDb,
  verify,
  type ActivatedUnit,
  type BaseFixtures,
} from './harness.js';

/**
 * Propiedad, transferencias, consentimientos y recompensas.
 *
 * El hilo conductor: reclamar y transferir una prenda exige demostrar tenencia
 * FISICA reciente (una verificacion valida y fresca), no solo conocer un
 * identificador.
 */

let app: FastifyInstance;
let db: PrismaClient;
let fixtures: BaseFixtures;
let unit: ActivatedUnit;
let fanToken: string;
let otherToken: string;
let fanId: string;

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
  unit = await seedActivatedUnit(db, fixtures);
  const fan = await createFan(db, 'hincha@test.local');
  fanId = fan.id;
  await createFan(db, 'otro@test.local');
  fanToken = await loginFan(app, 'hincha@test.local');
  otherToken = await loginFan(app, 'otro@test.local');
});

/** Verifica la unidad y devuelve la referencia del evento, como haria la web. */
async function freshVerification(token = unit.tagToken): Promise<string> {
  const { body } = await verify(app, token);
  return body.eventRef as string;
}

describe('reclamo de una prenda', () => {
  it('funciona tras una verificacion reciente', async () => {
    const eventRef = await freshVerification();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().maskedRef).toContain('•');

    const ownership = await db.ownership.findFirst({
      where: { jerseyUnitId: unit.unitId, endedAt: null },
    });
    expect(ownership?.fanId).toBe(fanId);
  });

  it('exige sesion de aficionado', async () => {
    const eventRef = await freshVerification();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      payload: { unitHandle: unit.unitId, eventRef },
    });
    expect(response.statusCode).toBe(401);
  });

  it('NO funciona sin una verificacion previa', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('NO funciona con la verificacion de OTRA prenda', async () => {
    const otherUnit = await seedActivatedUnit(db, fixtures, { emblemCode: 'EMB-OTRA' });
    const eventRef = await freshVerification(otherUnit.tagToken);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      // Se presenta la verificacion de otra unidad para reclamar esta.
      payload: { unitHandle: unit.unitId, eventRef },
    });
    expect(response.statusCode).toBe(400);
  });

  it('NO funciona con una verificacion caducada', async () => {
    const eventRef = await freshVerification();
    // Se envejece el evento mas alla de la ventana de 30 minutos.
    await db.verificationEvent.update({
      where: { id: eventRef },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('caduco');
  });

  it('NO funciona si la lectura fue sospechosa', async () => {
    const suspicious = await seedActivatedUnit(db, fixtures, {
      emblemCode: 'EMB-SOSPECHOSA',
      chipState: 'QUARANTINED',
      unitState: 'QUARANTINED',
    });
    const eventRef = await freshVerification(suspicious.tagToken);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: suspicious.unitId, eventRef },
    });
    expect(response.statusCode).toBe(403);
  });

  it('una prenda ya reclamada no puede reclamarla otra persona', async () => {
    const firstRef = await freshVerification();
    await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef: firstRef },
    });

    const secondRef = await freshVerification();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(otherToken),
      payload: { unitHandle: unit.unitId, eventRef: secondRef },
    });
    expect(response.statusCode).toBe(409);
  });

  it('la restriccion de base de datos impide dos titularidades activas', async () => {
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    // El indice unico parcial `Ownership_active_unique` es la ultima linea de
    // defensa si dos peticiones concurrentes superan la comprobacion de la API.
    const other = await db.fanAccount.findFirst({ where: { email: 'otro@test.local' } });
    await expect(
      db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId: other!.id } }),
    ).rejects.toThrow();
  });

  it('una prenda revocada no puede reclamarse', async () => {
    const revoked = await seedActivatedUnit(db, fixtures, {
      emblemCode: 'EMB-REVOCADA',
      chipState: 'REVOKED',
      unitState: 'REVOKED',
    });
    const eventRef = await freshVerification(revoked.tagToken);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: revoked.unitId, eventRef },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('transferencia de titularidad', () => {
  /**
   * Reclama la prenda como paso previo.
   *
   * Comprueba el codigo de estado a proposito: un reclamo que falla en silencio
   * hace que la prueba siguiente falle por "no es titular" y manda a depurar el
   * lugar equivocado.
   */
  async function claim(): Promise<void> {
    const eventRef = await freshVerification();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef },
    });
    if (response.statusCode !== 201) {
      throw new Error(
        `el reclamo previo fallo (${response.statusCode}): ${response.body}`,
      );
    }
  }

  it('el titular puede iniciarla y el destinatario aceptarla', async () => {
    await claim();

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });
    expect(started.statusCode).toBe(201);
    const invitationToken = started.json().invitationToken as string;

    // El token viaja una sola vez y no se almacena en claro.
    const stored = await db.ownershipTransfer.findFirst();
    expect(stored?.tokenHash).not.toBe(invitationToken);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(otherToken),
      payload: { token: invitationToken },
    });
    expect(accepted.statusCode).toBe(200);

    // Exactamente una titularidad activa, y es la del destinatario.
    const active = await db.ownership.findMany({
      where: { jerseyUnitId: unit.unitId, endedAt: null },
    });
    expect(active).toHaveLength(1);
    expect(active[0]!.fanId).not.toBe(fanId);

    const unitAfter = await db.jerseyUnit.findUnique({ where: { id: unit.unitId } });
    expect(unitAfter?.condition).toBe('TRANSFERRED');
  });

  it('quien no es titular no puede transferirla', async () => {
    await claim();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(otherToken),
      payload: { unitHandle: unit.unitId, toEmail: 'hincha@test.local' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('no se puede transferir a uno mismo', async () => {
    await claim();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'hincha@test.local' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('no puede haber dos transferencias pendientes de la misma prenda', async () => {
    await claim();
    await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'tercero@test.local' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('una invitacion dirigida a un correo no la acepta otra persona', async () => {
    await claim();
    await createFan(db, 'intruso@test.local');
    const intruderToken = await loginFan(app, 'intruso@test.local');

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(intruderToken),
      payload: { token: started.json().invitationToken },
    });
    expect(response.statusCode).toBe(403);
  });

  it('una invitacion caducada no se acepta', async () => {
    await claim();
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });

    await db.ownershipTransfer.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(otherToken),
      payload: { token: started.json().invitationToken },
    });
    expect(response.statusCode).toBe(400);

    const transfer = await db.ownershipTransfer.findFirst();
    expect(transfer?.state).toBe('EXPIRED');
  });

  it('una invitacion no puede usarse dos veces', async () => {
    await claim();
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });
    const token = started.json().invitationToken;

    await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(otherToken),
      payload: { token },
    });

    await createFan(db, 'tercero@test.local');
    const thirdToken = await loginFan(app, 'tercero@test.local');
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(thirdToken),
      payload: { token },
    });
    expect(replay.statusCode).toBe(404);
  });

  it('un token de invitacion inventado no sirve', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(otherToken),
      payload: { token: 'token-de-invitacion-completamente-falso' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('el titular puede cancelar una transferencia pendiente', async () => {
    await claim();
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/fan/transfers/${started.json().transferId}/cancel`,
      headers: bearer(fanToken),
    });
    expect(cancelled.statusCode).toBe(200);

    const accept = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers/accept',
      headers: bearer(otherToken),
      payload: { token: started.json().invitationToken },
    });
    expect(accept.statusCode).toBe(404);
  });

  it('una prenda en cuarentena no puede transferirse', async () => {
    await claim();
    await db.jerseyUnit.update({ where: { id: unit.unitId }, data: { state: 'QUARANTINED' } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/transfers',
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, toEmail: 'otro@test.local' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('historial de la prenda', () => {
  it('no revela la identidad de los propietarios anteriores', async () => {
    // Titularidad previa de otra persona, ya cerrada.
    const previous = await db.fanAccount.findFirst({ where: { email: 'otro@test.local' } });
    await db.ownership.create({
      data: {
        jerseyUnitId: unit.unitId,
        fanId: previous!.id,
        startedAt: new Date('2026-01-01'),
        endedAt: new Date('2026-02-01'),
      },
    });
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/fan/jerseys/${unit.unitId}/history`,
      headers: bearer(fanToken),
    });

    expect(response.statusCode).toBe(200);
    // Ningun dato personal del anterior propietario.
    expect(response.body).not.toContain('otro@test.local');
    expect(response.body).not.toContain(previous!.id);

    const timeline = response.json().timeline as { isYou: boolean; from: string }[];
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.isYou).toBe(false);
    expect(timeline[1]!.isYou).toBe(true);
    // Precision de mes, no de dia: una fecha exacta puede reidentificar.
    expect(timeline[0]!.from).toMatch(/^\d{4}-\d{2}$/);
  });

  it('quien no es titular no ve el historial', async () => {
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/fan/jerseys/${unit.unitId}/history`,
      headers: bearer(otherToken),
    });
    expect(response.statusCode).toBe(404);
  });

  it('el listado de prendas no expone tokens', async () => {
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fan/jerseys',
      headers: bearer(fanToken),
    });

    expect(response.body).not.toContain(unit.tagToken);
    expect(response.body).not.toContain(unit.qrToken);
    expect(response.body).not.toContain(unit.publicRef);
    expect(response.json().jerseys[0].maskedRef).toContain('•');
  });
});

describe('consentimientos', () => {
  it('por defecto ninguna finalidad esta otorgada', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fan/consents',
      headers: bearer(fanToken),
    });

    const consents = response.json().consents as { purpose: string; granted: boolean }[];
    expect(consents.every((c) => c.granted === false)).toBe(true);
  });

  it('se puede otorgar y revocar, y la revocacion deja rastro', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/fan/consents',
      headers: bearer(fanToken),
      payload: { purpose: 'MARKETING', granted: true },
    });

    let record = await db.consent.findFirst({ where: { fanId, purpose: 'MARKETING' } });
    expect(record?.granted).toBe(true);
    expect(record?.grantedAt).not.toBeNull();

    await app.inject({
      method: 'PUT',
      url: '/api/v1/fan/consents',
      headers: bearer(fanToken),
      payload: { purpose: 'MARKETING', granted: false },
    });

    record = await db.consent.findFirst({ where: { fanId, purpose: 'MARKETING' } });
    expect(record?.granted).toBe(false);
    // La fecha de revocacion es la prueba de que la persona ejercio su derecho.
    expect(record?.revokedAt).not.toBeNull();
  });

  it('rechaza una finalidad no reconocida', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/fan/consents',
      headers: bearer(fanToken),
      payload: { purpose: 'VENDER_MIS_DATOS', granted: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it('el catalogo publico declara lo que nunca exige consentimiento', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/consents/catalog' });

    expect(response.statusCode).toBe(200);
    const always = response.json().alwaysAvailable as string[];
    expect(always.join(' ')).toContain('Verificar');
  });
});

describe('verificar no depende de aceptar nada', () => {
  it('un anonimo sin consentimientos verifica igual', async () => {
    const { status, body } = await verify(app, unit.tagToken);
    expect(status).toBe(200);
    expect(body.unit).not.toBeNull();
  });

  it('el contenido geografico NO aparece sin consentimiento de ubicacion', async () => {
    await db.contentItem.create({
      data: {
        clubId: fixtures.clubId,
        kind: 'STORY',
        title: { es: 'Contenido geografico' },
        body: { es: 'Solo con consentimiento de ubicacion' },
        priority: 10,
        rules: { create: { conditions: { countryCodes: ['EC'] } } },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/units/${unit.unitId}/content`,
      headers: { 'cf-ipcountry': 'EC' },
    });

    const items = response.json().items as { title: string }[];
    expect(items.map((i) => i.title)).not.toContain('Contenido geografico');
  });

  it('el contenido patrocinado NO aparece sin consentimiento', async () => {
    await db.contentItem.create({
      data: {
        clubId: fixtures.clubId,
        kind: 'SPONSOR_MESSAGE',
        title: { es: 'Mensaje del patrocinador' },
        body: { es: 'Publicidad' },
        priority: 10,
        rules: { create: { conditions: {} } },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/units/${unit.unitId}/content`,
    });

    const items = response.json().items as { title: string }[];
    expect(items.map((i) => i.title)).not.toContain('Mensaje del patrocinador');
  });

  it('el modo de bajo consumo omite los medios pesados', async () => {
    await db.contentItem.create({
      data: {
        clubId: fixtures.clubId,
        kind: 'VIDEO',
        title: { es: 'Video pesado' },
        body: { es: 'x' },
        mediaUrl: 'https://cdn.test/v.mp4',
        estimatedMediaBytes: 9_000_000,
        priority: 10,
        rules: { create: { conditions: {} } },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/units/${unit.unitId}/content?lowData=1`,
    });

    const video = (response.json().items as { title: string; mediaUrl: string | null; mediaOmittedForLowData: boolean }[]).find(
      (i) => i.title === 'Video pesado',
    );
    expect(video?.mediaUrl).toBeNull();
    expect(video?.mediaOmittedForLowData).toBe(true);
  });

  it('respeta la cabecera Save-Data del navegador', async () => {
    await db.contentItem.create({
      data: {
        clubId: fixtures.clubId,
        kind: 'VIDEO',
        title: { es: 'Video pesado 2' },
        body: { es: 'x' },
        mediaUrl: 'https://cdn.test/v2.mp4',
        estimatedMediaBytes: 9_000_000,
        priority: 10,
        rules: { create: { conditions: {} } },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/units/${unit.unitId}/content`,
      headers: { 'save-data': 'on' },
    });
    expect(response.json().lowDataMode).toBe(true);
  });
});

describe('recompensas', () => {
  it('una recompensa que exige VERIFIED no se canjea con IDENTIFIED_ONLY', async () => {
    const reward = await db.reward.create({
      data: {
        name: 'Sorteo exclusivo',
        kind: 'RAFFLE_ENTRY',
        minTrustLevel: 'VERIFIED',
        requiresAccount: true,
        active: true,
      },
    });
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });
    const eventRef = await freshVerification();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/fan/rewards/${reward.id}/redeem`,
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef },
    });

    // Es el control que impide monetizar un identificador copiado.
    expect(response.statusCode).toBe(403);
  });

  it('una recompensa de nivel IDENTIFIED_ONLY si se canjea', async () => {
    const reward = await db.reward.create({
      data: {
        name: 'Fondo de pantalla',
        kind: 'CONTENT_UNLOCK',
        minTrustLevel: 'IDENTIFIED_ONLY',
        requiresAccount: true,
        active: true,
      },
    });
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });
    const eventRef = await freshVerification();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/fan/rewards/${reward.id}/redeem`,
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef },
    });
    expect(response.statusCode).toBe(201);
  });

  it('no se canjea dos veces la misma recompensa con la misma prenda', async () => {
    const reward = await db.reward.create({
      data: {
        name: 'Fondo unico',
        kind: 'CONTENT_UNLOCK',
        minTrustLevel: 'IDENTIFIED_ONLY',
        requiresAccount: true,
        active: true,
      },
    });
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    await app.inject({
      method: 'POST',
      url: `/api/v1/fan/rewards/${reward.id}/redeem`,
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef: await freshVerification() },
    });

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/fan/rewards/${reward.id}/redeem`,
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef: await freshVerification() },
    });
    expect(second.statusCode).toBe(409);
  });

  it('quien no es titular no canjea una recompensa que exige titularidad', async () => {
    const reward = await db.reward.create({
      data: {
        name: 'Solo titulares',
        kind: 'CONTENT_UNLOCK',
        minTrustLevel: 'IDENTIFIED_ONLY',
        requiresAccount: true,
        active: true,
      },
    });
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/fan/rewards/${reward.id}/redeem`,
      headers: bearer(otherToken),
      payload: { unitHandle: unit.unitId, eventRef: await freshVerification() },
    });
    expect(response.statusCode).toBe(403);
  });

  it('una recompensa agotada no se canjea', async () => {
    const reward = await db.reward.create({
      data: {
        name: 'Agotada',
        kind: 'RAFFLE_ENTRY',
        minTrustLevel: 'IDENTIFIED_ONLY',
        requiresAccount: true,
        stock: 0,
        active: true,
      },
    });
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/fan/rewards/${reward.id}/redeem`,
      headers: bearer(fanToken),
      payload: { unitHandle: unit.unitId, eventRef: await freshVerification() },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('soporte sin cuenta', () => {
  it('cualquiera puede abrir un caso sin registrarse', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/support/cases',
      payload: {
        contactEmail: 'alguien@test.local',
        reason: 'AUTHENTICITY_DOUBT',
        subject: 'Dudas sobre mi camiseta',
        description: 'Compre la camiseta en una feria y quiero confirmar que es original.',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().caseId).toBeTruthy();
  });

  it('la respuesta es identica exista o no la unidad referida', async () => {
    const withUnit = await app.inject({
      method: 'POST',
      url: '/api/v1/support/cases',
      payload: {
        contactEmail: 'a@test.local',
        reason: 'WARRANTY',
        subject: 'Garantia',
        description: 'Descripcion suficientemente larga para pasar la validacion.',
        unitHandle: unit.unitId,
      },
    });
    const withoutUnit = await app.inject({
      method: 'POST',
      url: '/api/v1/support/cases',
      payload: {
        contactEmail: 'b@test.local',
        reason: 'WARRANTY',
        subject: 'Garantia',
        description: 'Descripcion suficientemente larga para pasar la validacion.',
        unitHandle: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(withUnit.statusCode).toBe(withoutUnit.statusCode);
    expect(withUnit.json().message).toBe(withoutUnit.json().message);
  });
});
