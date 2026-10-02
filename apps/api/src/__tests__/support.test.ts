import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  bearer,
  createFan,
  createTestApp,
  createUser,
  loginAdmin,
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
 * Cierre del circuito de soporte y privacidad.
 *
 * El hilo conductor: el motor de riesgo manda al aficionado a soporte, soporte
 * debe poder resolver, y la respuesta debe volver al aficionado. Estas pruebas
 * recorren ese circuito completo y comprueban lo que NUNCA debe filtrarse.
 */

let app: FastifyInstance;
let db: PrismaClient;
let fixtures: BaseFixtures;
let unit: ActivatedUnit;
let soporte: string;
let fanId: string;
let fanToken: string;

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
  await createUser(db, { email: 'soporte@test.local', role: 'SUPPORT' });
  soporte = await loginAdmin(app, 'soporte@test.local');
  const fan = await createFan(db, 'hincha@test.local');
  fanId = fan.id;
  fanToken = await loginFan(app, 'hincha@test.local');
});

/**
 * Abre un caso tal como lo haria la web publica.
 *
 * Comprueba el codigo de estado: un alta que falla en silencio (por ejemplo por
 * limite de peticiones) devolveria `undefined` y las pruebas siguientes
 * fallarian con un 404 desconcertante en lugar de senalar la causa.
 */
async function abrirCaso(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/support/cases',
    payload: {
      contactEmail: 'hincha@test.local',
      reason: 'AUTHENTICITY_DOUBT',
      subject: 'Dudas sobre mi camiseta',
      description: 'Compre la camiseta en una feria y quiero confirmar que es original.',
      unitHandle: unit.unitId,
      ...overrides,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`no se pudo abrir el caso (${response.statusCode}): ${response.body}`);
  }
  return response.json().caseId as string;
}

/** Crea una solicitud de privacidad, fallando de forma visible si no se pudo. */
async function crearSolicitudDePrivacidad(type: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/privacy/requests',
    payload: { email: 'hincha@test.local', type, details: 'Solicitud de prueba' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`no se pudo crear la solicitud (${response.statusCode}): ${response.body}`);
  }
  return response.json().requestId as string;
}

describe('el circuito completo: el aficionado escribe, soporte resuelve, el aficionado lee', () => {
  it('recorre el circuito de principio a fin', async () => {
    // 1. El aficionado abre el caso sin necesitar cuenta.
    const casoId = await abrirCaso();

    // 2. Soporte lo ve con sus transiciones posibles.
    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
    });
    expect(detalle.statusCode).toBe(200);
    expect(detalle.json().state).toBe('OPEN');
    expect(detalle.json().allowedTransitions).toContain('IN_PROGRESS');
    expect(detalle.json().unit.maskedRef).toContain('•');

    // 3. Soporte se lo asigna y lo pone en curso.
    const soporteUser = await db.user.findFirst({ where: { email: 'soporte@test.local' } });
    const asignado = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { state: 'IN_PROGRESS', assigneeId: soporteUser!.id },
    });
    expect(asignado.statusCode).toBe(200);
    expect(asignado.json().state).toBe('IN_PROGRESS');

    // 4. Soporte anota algo INTERNO.
    const interna = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/support-cases/${casoId}/notes`,
      headers: bearer(soporte),
      payload: { body: 'Hipotesis interna: revisar el lote de origen antes de responder.' },
    });
    expect(interna.statusCode).toBe(201);
    expect(interna.json().visibleToCustomer).toBe(false);

    // 5. Soporte RESPONDE al cliente.
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/support-cases/${casoId}/notes`,
      headers: bearer(soporte),
      payload: {
        body: 'Confirmamos que su prenda esta registrada. Le enviamos el certificado.',
        visibleToCustomer: true,
      },
    });
    expect(respuesta.statusCode).toBe(201);

    // Responder pasa la bola al cliente.
    const tras = await db.supportCase.findUnique({ where: { id: casoId } });
    expect(tras?.state).toBe('WAITING_CUSTOMER');

    // 6. El aficionado ve la respuesta, y SOLO la respuesta.
    const suyos = await app.inject({
      method: 'GET',
      url: '/api/v1/fan/support-cases',
      headers: bearer(fanToken),
    });
    expect(suyos.statusCode).toBe(200);
    const caso = suyos.json().cases[0];
    expect(caso.replies).toHaveLength(1);
    expect(caso.replies[0].body).toContain('esta registrada');
    // La nota interna NO viaja al cliente. Es la garantia central de esta ruta.
    expect(suyos.body).not.toContain('Hipotesis interna');

    // 7. Soporte cierra el caso.
    const resuelto = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { state: 'RESOLVED' },
    });
    expect(resuelto.statusCode).toBe(200);
    expect(resuelto.json().resolvedAt).not.toBeNull();

    // 8. Todo el circuito queda auditado.
    const acciones = (await db.auditEvent.findMany()).map((a) => a.action);
    expect(acciones).toContain('support.case.updated');
    expect(acciones).toContain('support.case.noted');
    expect(acciones).toContain('support.case.replied');
  });

  it('un caso abierto antes de tener cuenta aparece al registrarse con el mismo correo', async () => {
    // El caso se abre con el correo, sin cuenta asociada.
    const casoId = await abrirCaso({ contactEmail: 'hincha@test.local' });
    await db.supportCase.update({ where: { id: casoId }, data: { fanId: null } });

    const suyos = await app.inject({
      method: 'GET',
      url: '/api/v1/fan/support-cases',
      headers: bearer(fanToken),
    });
    expect(suyos.json().cases).toHaveLength(1);
  });

  it('el aficionado no ve los casos de otra persona', async () => {
    await abrirCaso({ contactEmail: 'otra-persona@test.local' });
    await createFan(db, 'tercero@test.local');
    const otroToken = await loginFan(app, 'tercero@test.local');

    const suyos = await app.inject({
      method: 'GET',
      url: '/api/v1/fan/support-cases',
      headers: bearer(otroToken),
    });
    expect(suyos.json().cases).toHaveLength(0);
  });
});

describe('maquina de estados del caso', () => {
  it('no permite reabrir un caso cerrado', async () => {
    const casoId = await abrirCaso();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { state: 'CLOSED' },
    });

    const reabrir = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { state: 'IN_PROGRESS' },
    });
    // Si vuelve el problema es un caso nuevo, y asi el historial dice la verdad
    // sobre cuantas veces ocurrio.
    expect(reabrir.statusCode).toBe(409);
  });

  it('un caso cerrado no admite notas nuevas', async () => {
    const casoId = await abrirCaso();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { state: 'CLOSED' },
    });

    const nota = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/support-cases/${casoId}/notes`,
      headers: bearer(soporte),
      payload: { body: 'Intento de anadir algo a un caso cerrado.' },
    });
    expect(nota.statusCode).toBe(409);
  });

  it('exige indicar al menos un cambio', async () => {
    const casoId = await abrirCaso();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('no permite asignar un caso a quien no puede atenderlo', async () => {
    const casoId = await abrirCaso();
    const operario = await createUser(db, {
      email: 'operario-suelto@test.local',
      role: 'PRODUCTION_OPERATOR',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { assigneeId: operario.id },
    });
    // Asignar a alguien sin permiso de soporte deja el caso huerfano.
    expect(response.statusCode).toBe(400);
  });

  it('no permite asignar un caso a un usuario inactivo', async () => {
    const casoId = await abrirCaso();
    const otro = await createUser(db, { email: 'soporte-baja@test.local', role: 'SUPPORT' });
    await db.user.update({ where: { id: otro.id }, data: { active: false } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/support-cases/${casoId}`,
      headers: bearer(soporte),
      payload: { assigneeId: otro.id },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('ficha de aficionado para soporte', () => {
  it('devuelve el minimo necesario y deja rastro de la consulta', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/fans/${fanId}`,
      headers: bearer(soporte),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe('hincha@test.local');
    // Nunca el hash de contrasena.
    expect(response.body).not.toContain('$argon2');
    expect(response.body).not.toContain('passwordHash');

    // Consultar una ficha personal siempre queda auditado: sin esto, una
    // consulta masiva seria indistinguible de la atencion legitima.
    const audit = await db.auditEvent.findFirst({ where: { action: 'support.fan.viewed' } });
    expect(audit).not.toBeNull();
    expect(audit?.entityId).toBe(fanId);
  });

  it('muestra la referencia de las prendas ENMASCARADA, incluso a soporte', async () => {
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/fans/${fanId}`,
      headers: bearer(soporte),
    });

    const jersey = response.json().jerseys[0];
    expect(jersey.maskedRef).toContain('•');
    // Para atender un caso basta reconocer la prenda.
    expect(response.body).not.toContain(unit.publicRef);
  });

  it('un patrocinador no puede consultar una ficha de aficionado', async () => {
    await createUser(db, { email: 'sp-ficha@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp-ficha@test.local');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/fans/${fanId}`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('el operario de planta tampoco', async () => {
    await createUser(db, { email: 'op-ficha@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginAdmin(app, 'op-ficha@test.local');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/fans/${fanId}`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('liberacion de titularidad asistida por soporte', () => {
  async function conTitular(): Promise<void> {
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });
  }

  it('libera la prenda y la vuelve reclamable', async () => {
    await conTitular();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/units/${unit.unitId}/ownership/release`,
      headers: bearer(soporte),
      payload: { reason: 'El titular perdio acceso a su cuenta y el comprador no puede reclamar.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().claimableAgain).toBe(true);

    const activas = await db.ownership.count({
      where: { jerseyUnitId: unit.unitId, endedAt: null },
    });
    expect(activas).toBe(0);

    // Y ahora otra persona SI puede reclamarla: es el resultado que buscabamos.
    await createFan(db, 'comprador@test.local');
    const compradorToken = await loginFan(app, 'comprador@test.local');
    const { body } = await verify(app, unit.tagToken);

    const reclamo = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/claims',
      headers: bearer(compradorToken),
      payload: { unitHandle: unit.unitId, eventRef: body.eventRef },
    });
    expect(reclamo.statusCode).toBe(201);
  });

  it('exige un motivo suficientemente explicito', async () => {
    await conTitular();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/units/${unit.unitId}/ownership/release`,
      headers: bearer(soporte),
      payload: { reason: 'porque' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('registra a quien se le retiro la titularidad', async () => {
    await conTitular();
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/units/${unit.unitId}/ownership/release`,
      headers: bearer(soporte),
      payload: { reason: 'Reclamacion resuelta a favor del comprador, caso documentado.' },
    });

    const audit = await db.auditEvent.findFirst({ where: { action: 'ownership.released' } });
    expect(audit).not.toBeNull();
    // La decision debe ser revisable: hay que saber a quien afecto.
    expect(JSON.stringify(audit?.metadata)).toContain(fanId);
  });

  it('cancela las transferencias pendientes al liberar', async () => {
    await conTitular();
    await db.ownershipTransfer.create({
      data: {
        jerseyUnitId: unit.unitId,
        fromFanId: fanId,
        tokenHash: 'hash-pendiente-al-liberar',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/units/${unit.unitId}/ownership/release`,
      headers: bearer(soporte),
      payload: { reason: 'Titularidad liberada por resolucion de un caso de soporte.' },
    });

    // Una invitacion de quien ya no es titular no debe poder aceptarse despues.
    const transferencia = await db.ownershipTransfer.findFirst();
    expect(transferencia?.state).toBe('CANCELLED');
  });

  it('falla si la unidad no tiene titular', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/units/${unit.unitId}/ownership/release`,
      headers: bearer(soporte),
      payload: { reason: 'Intento de liberar una unidad que no tiene titular activo.' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('el operario de planta NO puede liberar titularidades', async () => {
    await conTitular();
    await createUser(db, { email: 'op-libera@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginAdmin(app, 'op-libera@test.local');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/units/${unit.unitId}/ownership/release`,
      headers: bearer(token),
      payload: { reason: 'Intento no autorizado de liberar una titularidad ajena.' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('solicitudes de privacidad', () => {
  const crearSolicitud = (type = 'ACCESS') => crearSolicitudDePrivacidad(type);

  it('el plazo de atencion es ahora aplicable: se puede resolver', async () => {
    const id = await crearSolicitud();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy-requests/${id}`,
      headers: bearer(soporte),
      payload: {
        state: 'COMPLETED',
        resolution: 'Se envio al titular la copia de sus datos por correo el 2026-03-05.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().resolvedAt).not.toBeNull();

    const solicitud = await db.privacyRequest.findUnique({ where: { id } });
    // Queda registrado QUIEN la resolvio: un derecho ejercido sin responsable
    // identificable no es auditable.
    expect(solicitud?.resolvedById).not.toBeNull();
  });

  it('no se puede cerrar una solicitud sin explicar como se resolvio', async () => {
    const id = await crearSolicitud();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy-requests/${id}`,
      headers: bearer(soporte),
      payload: { state: 'COMPLETED' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('marca las solicitudes vencidas', async () => {
    const id = await crearSolicitud();
    await db.privacyRequest.update({
      where: { id },
      data: { dueAt: new Date(Date.now() - 86_400_000) },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/privacy-requests/${id}`,
      headers: bearer(soporte),
    });
    expect(response.json().overdue).toBe(true);
  });
});

describe('ejecucion del derecho de eliminacion', () => {
  const solicitudDeEliminacion = () => crearSolicitudDePrivacidad('DELETION');

  it('anonimiza de forma irreversible y conserva la prueba del consentimiento', async () => {
    await db.ownership.create({ data: { jerseyUnitId: unit.unitId, fanId } });
    await db.consent.create({
      data: {
        fanId,
        purpose: 'MARKETING',
        granted: true,
        grantedAt: new Date(),
        policyVersion: '2026-01',
      },
    });

    const id = await solicitudDeEliminacion();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(soporte),
      payload: { confirm: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().method).toBe('anonimizacion_irreversible');

    const fan = await db.fanAccount.findUnique({ where: { id: fanId } });
    // Los datos IDENTIFICATIVOS desaparecen.
    expect(fan?.email).not.toBe('hincha@test.local');
    expect(fan?.email).toContain('@invalid');
    expect(fan?.passwordHash).toBeNull();
    expect(fan?.displayName).toBeNull();
    expect(fan?.deletedAt).not.toBeNull();

    // La PRUEBA del consentimiento se conserva, ya sin identificar a nadie.
    expect(await db.consent.count({ where: { fanId } })).toBe(1);

    // La prenda deja de tener titular y vuelve a ser reclamable: el objeto
    // fisico sigue existiendo y tiene un dueno real.
    expect(await db.ownership.count({ where: { fanId, endedAt: null } })).toBe(0);
  });

  it('revoca las sesiones vivas del aficionado', async () => {
    const id = await solicitudDeEliminacion();

    // La sesion funciona antes.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/fan/me', headers: bearer(fanToken) }))
        .statusCode,
    ).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(soporte),
      payload: { confirm: true },
    });

    // Y deja de funcionar inmediatamente despues.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/fan/me', headers: bearer(fanToken) }))
        .statusCode,
    ).toBe(401);
  });

  it('exige confirmacion explicita', async () => {
    const id = await solicitudDeEliminacion();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(soporte),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('no se ejecuta dos veces', async () => {
    const id = await solicitudDeEliminacion();
    const payload = { confirm: true };

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(soporte),
      payload,
    });
    const segunda = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(soporte),
      payload,
    });
    expect(segunda.statusCode).toBe(409);
  });

  it('rechaza ejecutarla sobre una solicitud que no es de eliminacion', async () => {
    const id = await crearSolicitudAcceso();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(soporte),
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it('NO permite declarar completada una eliminacion que no se ejecuto', async () => {
    const id = await solicitudDeEliminacion();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/privacy-requests/${id}`,
      headers: bearer(soporte),
      payload: { state: 'COMPLETED', resolution: 'Atendida.' },
    });

    // Declarar cumplido un derecho que sigue sin cumplirse es peor que no
    // atenderlo: deja constancia falsa.
    expect(response.statusCode).toBe(409);
  });

  it('un rol sin privacy:write no puede ejecutarla', async () => {
    const id = await solicitudDeEliminacion();
    await createUser(db, { email: 'club-elimina@test.local', role: 'CLUB_ADMIN' });
    const token = await loginAdmin(app, 'club-elimina@test.local');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/privacy-requests/${id}/execute-deletion`,
      headers: bearer(token),
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(403);
  });

  const crearSolicitudAcceso = () => crearSolicitudDePrivacidad('ACCESS');
});

describe('aprovisionamiento de etiquetas para piloto', () => {
  let jefe: string;

  beforeEach(async () => {
    await createUser(db, { email: 'jefe-tags@test.local', role: 'MARATHON_ADMIN' });
    jefe = await loginAdmin(app, 'jefe-tags@test.local');
  });

  async function preparar(body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/admin/tags/provision',
      headers: bearer(jefe),
      payload: { skuCode: fixtures.skuCode, baseUrl: 'http://192.168.1.50:3000', ...body },
    });
  }

  it('devuelve una URL que abre la camiseta recien preparada', async () => {
    const response = await preparar({});
    expect(response.statusCode).toBe(201);

    const { tagUrl, publicRef } = response.json();
    expect(tagUrl).toMatch(/^http:\/\/192\.168\.1\.50:3000\/v\//);
    expect(publicRef).toMatch(/^MEV-/);

    // La URL devuelta funciona de verdad: el token que lleva resuelve.
    const token = tagUrl.split('/v/')[1] as string;
    const { body } = await verify(app, token);
    expect(body.trustLevel).toBe('IDENTIFIED_ONLY');
    expect(body.unit.model).toBe('Local Prueba');
  });

  it('RECHAZA localhost: se graba sin error y luego no abre nada en el telefono', async () => {
    const response = await preparar({ baseUrl: 'http://localhost:3000' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('direccion de red');

    // Y no deja basura a medias en la base de datos.
    expect(await db.jerseyUnit.count({ where: { publicRef: { startsWith: 'MEV-' } } })).toBe(1);
  });

  it('rechaza 127.0.0.1 por la misma razon', async () => {
    expect((await preparar({ baseUrl: 'http://127.0.0.1:3000' })).statusCode).toBe(400);
  });

  it('RECHAZA una URL que no cabe en el chip antes de crear nada', async () => {
    const dominioLargo = `http://${'x'.repeat(120)}.test`;
    const response = await preparar({ baseUrl: dominioLargo, chipType: 'NTAG213' });

    // Una escritura truncada deja el chip inservible: mejor fallar antes.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('bytes');
  });

  it('la misma URL SI cabe en una NTAG215', async () => {
    const dominioLargo = `http://${'x'.repeat(120)}.test`;
    expect((await preparar({ baseUrl: dominioLargo, chipType: 'NTAG215' })).statusCode).toBe(201);
  });

  it('marca la unidad como de piloto, para no confundirla con produccion', async () => {
    const response = await preparar({});
    const unidad = await db.jerseyUnit.findUnique({
      where: { id: response.json().unitId },
      include: { emblem: { include: { chip: true } } },
    });

    // El UID sintetico hace evidente en el panel que no paso por la linea.
    expect(unidad?.emblem?.chip?.uid).toMatch(/^PILOT-/);

    const audit = await db.auditEvent.findFirst({ where: { action: 'tags.provisioned' } });
    expect(JSON.stringify(audit?.metadata)).toContain('aprovisionamiento_de_piloto');
  });

  it('el operario de planta NO puede aprovisionar: exige production:activate', async () => {
    await createUser(db, { email: 'op-tags@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginAdmin(app, 'op-tags@test.local');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tags/provision',
      headers: bearer(token),
      payload: { skuCode: fixtures.skuCode, baseUrl: 'http://192.168.1.50:3000' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('las direcciones sugeridas nunca incluyen localhost', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tags/direcciones',
      headers: bearer(jefe),
    });

    expect(response.statusCode).toBe(200);
    const { direcciones, advertencia } = response.json();
    for (const d of direcciones) {
      expect(d.base).not.toContain('localhost');
      expect(d.base).not.toContain('127.0.0.1');
    }
    // En pruebas FAN_WEB_PUBLIC_URL es localhost, asi que debe advertirlo.
    expect(advertencia).toContain('localhost');
  });
});
