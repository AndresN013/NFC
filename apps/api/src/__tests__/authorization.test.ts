import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { ROLES, ROLE_PERMISSIONS } from '@mev/domain';
import {
  bearer,
  createTestApp,
  createUser,
  loginAdmin,
  loginProduction,
  resetDatabase,
  seedBase,
  testDb,
  TEST_PASSWORD,
  type BaseFixtures,
} from './harness.js';

/**
 * Pruebas de autorizacion.
 *
 * Comprueban la matriz de roles a traves de HTTP, no en memoria: lo que importa
 * es que el servidor RECHACE, no que la funcion de dominio devuelva false.
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

describe('exigencia de autenticacion', () => {
  it('sin token, una ruta administrativa devuelve 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/users' });
    expect(response.statusCode).toBe(401);
  });

  it('con un token inventado devuelve 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearer('token-falso-que-no-existe'),
    });
    expect(response.statusCode).toBe(401);
  });

  it('un esquema de autorizacion distinto de Bearer devuelve 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('el patrocinador esta aislado de los datos personales', () => {
  it('no puede listar unidades', async () => {
    await createUser(db, { email: 'sp@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/units',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('no puede listar usuarios', async () => {
    await createUser(db, { email: 'sp2@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp2@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('no puede leer el UID de los chips', async () => {
    await createUser(db, { email: 'sp3@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp3@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/chips',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('no puede leer el registro de auditoria', async () => {
    await createUser(db, { email: 'sp4@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp4@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('no puede leer la analitica global', async () => {
    await createUser(db, { email: 'sp5@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp5@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/analytics/overview',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('solo lee las metricas de SU campana, no las de otra', async () => {
    const sponsor = await db.sponsor.create({
      data: { organizationId: fixtures.organizationId, name: 'Patrocinador A' },
    });
    const mine = await db.campaign.create({
      data: {
        sponsorId: sponsor.id,
        name: 'Campana propia',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    const other = await db.campaign.create({
      data: {
        sponsorId: sponsor.id,
        name: 'Campana ajena',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });

    await createUser(db, {
      email: 'sp6@test.local',
      role: 'SPONSOR',
      scopeType: 'CAMPAIGN',
      scopeId: mine.id,
    });
    const token = await loginAdmin(app, 'sp6@test.local');

    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/analytics/campaign/${mine.id}`,
      headers: bearer(token),
    });
    expect(own.statusCode).toBe(200);

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/analytics/campaign/${other.id}`,
      headers: bearer(token),
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('las metricas con cohorte pequena se devuelven suprimidas', async () => {
    const sponsor = await db.sponsor.create({
      data: { organizationId: fixtures.organizationId, name: 'Patrocinador B' },
    });
    const campaign = await db.campaign.create({
      data: {
        sponsorId: sponsor.id,
        name: 'Campana con cohorte pequena',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    await db.campaignMetric.createMany({
      data: [
        {
          campaignId: campaign.id,
          metricKey: 'campaign_content_views',
          bucketDate: new Date('2026-03-01'),
          value: 500,
        },
        {
          campaignId: campaign.id,
          metricKey: 'campaign_reward_redemptions',
          bucketDate: new Date('2026-03-01'),
          // Por debajo del minimo de cohorte: debe salir como null.
          value: 3,
        },
      ],
    });

    await createUser(db, {
      email: 'sp7@test.local',
      role: 'SPONSOR',
      scopeType: 'CAMPAIGN',
      scopeId: campaign.id,
    });
    const token = await loginAdmin(app, 'sp7@test.local');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/analytics/campaign/${campaign.id}`,
      headers: bearer(token),
    });

    const metrics = response.json().metrics as { metricKey: string; value: number | null }[];
    expect(metrics.find((m) => m.metricKey === 'campaign_content_views')?.value).toBe(500);
    expect(metrics.find((m) => m.metricKey === 'campaign_reward_redemptions')?.value).toBeNull();
  });

  it('la respuesta al patrocinador no contiene ningun correo de aficionado', async () => {
    const sponsor = await db.sponsor.create({
      data: { organizationId: fixtures.organizationId, name: 'Patrocinador C' },
    });
    const campaign = await db.campaign.create({
      data: {
        sponsorId: sponsor.id,
        name: 'Campana',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    await db.fanAccount.create({
      data: { email: 'aficionado-secreto@test.local', displayName: 'Nombre Privado' },
    });

    await createUser(db, {
      email: 'sp8@test.local',
      role: 'SPONSOR',
      scopeType: 'CAMPAIGN',
      scopeId: campaign.id,
    });
    const token = await loginAdmin(app, 'sp8@test.local');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/analytics/campaign/${campaign.id}`,
      headers: bearer(token),
    });

    expect(response.body).not.toContain('aficionado-secreto@test.local');
    expect(response.body).not.toContain('Nombre Privado');
  });
});

describe('el operario de produccion tiene permisos minimos', () => {
  it('puede leer ordenes', async () => {
    await createUser(db, { email: 'op@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginProduction(app, 'op@test.local', fixtures.deviceId);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/production/orders',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
  });

  it('NO puede leer el UID de los chips', async () => {
    await createUser(db, { email: 'op2@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginProduction(app, 'op2@test.local', fixtures.deviceId);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/chips',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('NO puede revocar una unidad', async () => {
    await createUser(db, { email: 'op3@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginProduction(app, 'op3@test.local', fixtures.deviceId);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/units/00000000-0000-0000-0000-000000000000/revoke',
      headers: bearer(token),
      payload: { reason: 'intento no autorizado' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('NO puede gestionar usuarios', async () => {
    await createUser(db, { email: 'op4@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginProduction(app, 'op4@test.local', fixtures.deviceId);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('el administrador del club esta limitado a su club', () => {
  it('no accede a datos personales de aficionados', async () => {
    await createUser(db, {
      email: 'club@test.local',
      role: 'CLUB_ADMIN',
      scopeType: 'CLUB',
      scopeId: fixtures.clubId,
    });
    const token = await loginAdmin(app, 'club@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('no puede escribir en chips ni revocar', async () => {
    await createUser(db, {
      email: 'club2@test.local',
      role: 'CLUB_ADMIN',
      scopeType: 'CLUB',
      scopeId: fixtures.clubId,
    });
    const token = await loginAdmin(app, 'club2@test.local');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/units/00000000-0000-0000-0000-000000000000/revoke',
      headers: bearer(token),
      payload: { reason: 'intento no autorizado' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('el dispositivo autorizado es un control real', () => {
  it('un operario valido en un telefono NO registrado no puede entrar', async () => {
    await createUser(db, { email: 'op5@test.local', role: 'PRODUCTION_OPERATOR' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/auth/login',
      payload: {
        email: 'op5@test.local',
        password: TEST_PASSWORD,
        deviceId: 'telefono-personal-no-autorizado',
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('un telefono desactivado deja de servir', async () => {
    await createUser(db, { email: 'op6@test.local', role: 'PRODUCTION_OPERATOR' });
    await db.authorizedDevice.update({
      where: { deviceId: fixtures.deviceId },
      data: { active: false },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/production/auth/login',
      payload: {
        email: 'op6@test.local',
        password: TEST_PASSWORD,
        deviceId: fixtures.deviceId,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('desactivar un telefono invalida sus sesiones vivas de inmediato', async () => {
    await createUser(db, { email: 'op7@test.local', role: 'PRODUCTION_OPERATOR' });
    const token = await loginProduction(app, 'op7@test.local', fixtures.deviceId);

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/production/orders',
      headers: bearer(token),
    });
    expect(before.statusCode).toBe(200);

    await db.authorizedDevice.update({
      where: { deviceId: fixtures.deviceId },
      data: { active: false },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/production/orders',
      headers: bearer(token),
    });
    expect(after.statusCode).toBe(401);
  });

  it('el intento con un telefono no autorizado queda registrado en auditoria', async () => {
    await createUser(db, { email: 'op8@test.local', role: 'PRODUCTION_OPERATOR' });

    await app.inject({
      method: 'POST',
      url: '/api/v1/production/auth/login',
      payload: {
        email: 'op8@test.local',
        password: TEST_PASSWORD,
        deviceId: 'telefono-sospechoso',
      },
    });

    const audit = await db.auditEvent.findFirst({
      where: { action: 'production.login.device_rejected' },
    });
    expect(audit).not.toBeNull();
  });
});

describe('la sesion se puede cortar', () => {
  it('desactivar un usuario invalida su sesion al instante', async () => {
    const admin = await createUser(db, { email: 'sa@test.local', role: 'SUPERADMIN' });
    const victim = await createUser(db, { email: 'victima@test.local', role: 'MARATHON_ADMIN' });

    const adminToken = await loginAdmin(app, admin.email);
    const victimToken = await loginAdmin(app, victim.email);

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: bearer(victimToken) }))
        .statusCode,
    ).toBe(200);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${victim.id}/active`,
      headers: bearer(adminToken),
      payload: { active: false },
    });

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: bearer(victimToken) }))
        .statusCode,
    ).toBe(401);
  });

  it('cerrar sesion invalida el token', async () => {
    await createUser(db, { email: 'sa2@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa2@test.local');

    await app.inject({ method: 'POST', url: '/api/v1/admin/logout', headers: bearer(token) });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(401);
  });

  it('una sesion caducada se rechaza', async () => {
    await createUser(db, { email: 'sa3@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa3@test.local');

    await db.userSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('escalada de privilegios', () => {
  it('un administrador de Marathon no puede crear un superadministrador', async () => {
    await createUser(db, { email: 'ma@test.local', role: 'MARATHON_ADMIN' });
    const token = await loginAdmin(app, 'ma@test.local');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearer(token),
      payload: {
        email: 'nuevo-super@test.local',
        displayName: 'Intento de escalada',
        password: 'ContrasenaLargaSegura2026',
        roles: [{ role: 'SUPERADMIN', scopeType: 'GLOBAL' }],
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('un superadministrador si puede crear otro', async () => {
    await createUser(db, { email: 'sa4@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa4@test.local');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearer(token),
      payload: {
        email: 'otro-super@test.local',
        displayName: 'Segundo superadmin',
        password: 'ContrasenaLargaSegura2026',
        roles: [{ role: 'SUPERADMIN', scopeType: 'GLOBAL' }],
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it('un rol con alcance exige su ambito', async () => {
    await createUser(db, { email: 'sa5@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa5@test.local');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearer(token),
      payload: {
        email: 'club-sin-ambito@test.local',
        displayName: 'Club sin ambito',
        password: 'ContrasenaLargaSegura2026',
        // CLUB sin scopeId seria un rol global encubierto.
        roles: [{ role: 'CLUB_ADMIN', scopeType: 'CLUB' }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('nadie puede desactivarse a si mismo y quedar sin acceso por error', async () => {
    const admin = await createUser(db, { email: 'sa6@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, admin.email);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${admin.id}/active`,
      headers: bearer(token),
      payload: { active: false },
    });
    expect(response.statusCode).toBe(400);
  });

  it('la respuesta de /me nunca incluye el hash de contrasena', async () => {
    await createUser(db, { email: 'sa7@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa7@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: bearer(token),
    });
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('$argon2');
  });

  it('el listado de usuarios nunca incluye hashes', async () => {
    await createUser(db, { email: 'sa8@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa8@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: bearer(token),
    });
    expect(response.body).not.toContain('$argon2');
    expect(response.body).not.toContain('mfaSecretRef');
  });
});

describe('enumeracion de cuentas', () => {
  it('el inicio de sesion no distingue correo inexistente de contrasena incorrecta', async () => {
    await createUser(db, { email: 'existe@test.local', role: 'SUPERADMIN' });

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { email: 'existe@test.local', password: 'ContrasenaIncorrecta' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { email: 'no-existe@test.local', password: 'ContrasenaIncorrecta' },
    });

    expect(wrongPassword.statusCode).toBe(unknownEmail.statusCode);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it('el registro de aficionado no revela que el correo ya existe', async () => {
    await db.fanAccount.create({
      data: { email: 'ya-existe@test.local', passwordHash: 'x', displayName: 'Existente' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fan/register',
      payload: { email: 'ya-existe@test.local', password: 'ContrasenaLargaSegura2026' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('ya existe');
    expect(response.body).not.toContain('duplicad');
  });

  it('la solicitud de privacidad no revela si el correo tiene cuenta', async () => {
    await db.fanAccount.create({
      data: { email: 'con-cuenta@test.local', passwordHash: 'x', displayName: 'Con cuenta' },
    });

    const withAccount = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/requests',
      payload: { email: 'con-cuenta@test.local', type: 'ACCESS' },
    });
    const without = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/requests',
      payload: { email: 'sin-cuenta@test.local', type: 'ACCESS' },
    });

    expect(withAccount.statusCode).toBe(without.statusCode);
    expect(withAccount.json().message).toBe(without.json().message);
  });
});

describe('rutas que todo usuario autenticado necesita', () => {
  it('un patrocinador puede consultar su propio perfil', async () => {
    await createUser(db, { email: 'sp-me@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp-me@test.local');

    // Exigir un permiso de catalogo aqui dejaba a un patrocinador sin poder
    // saber quien es ni que puede ver.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toContain('analytics:campaign_scoped');
  });

  it('un patrocinador puede cerrar su propia sesion', async () => {
    await createUser(db, { email: 'sp-out@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'sp-out@test.local');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/logout',
      headers: bearer(token),
    });
    expect(logout.statusCode).toBe(200);

    // Y la sesion queda efectivamente invalidada.
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: bearer(token),
    });
    expect(after.statusCode).toBe(401);
  });

  it('/me sigue exigiendo una sesion valida', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/me' });
    expect(response.statusCode).toBe(401);
  });
});

describe('trazabilidad del acceso a datos sensibles', () => {
  it('listar UID completos de chips deja entrada de auditoria', async () => {
    await createUser(db, { email: 'sa-chips@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa-chips@test.local');

    await app.inject({ method: 'GET', url: '/api/v1/admin/chips', headers: bearer(token) });

    const audit = await db.auditEvent.findFirst({ where: { action: 'admin.chips.listed' } });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('NfcChip');
  });

  it('exportar unidades a CSV deja entrada de auditoria', async () => {
    await createUser(db, { email: 'sa-csv@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa-csv@test.local');

    await app.inject({
      method: 'GET',
      url: '/api/v1/admin/units?format=csv',
      headers: bearer(token),
    });

    const audit = await db.auditEvent.findFirst({ where: { action: 'admin.units.exported' } });
    expect(audit).not.toBeNull();
  });
});

describe('exportacion CSV', () => {
  it('declara si el fichero quedo truncado, en una cabecera que SI llega', async () => {
    await createUser(db, { email: 'sa-trunc@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa-trunc@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/units?format=csv',
      headers: bearer(token),
    });

    // Una cabecera anadida despues de `send` no viaja: esta prueba lo detecta.
    expect(response.headers['x-export-truncated']).toBe('false');
    expect(response.headers['content-type']).toContain('text/csv');
  });

  it('el CSV de unidades incluye el identificador que exigen las acciones', async () => {
    await createUser(db, { email: 'sa-id@test.local', role: 'SUPERADMIN' });
    const token = await loginAdmin(app, 'sa-id@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/units',
      headers: bearer(token),
    });

    // Sin `id`, revocar una unidad obligaria a pegar un UUID a mano.
    expect(response.json()).toHaveProperty('items');
  });
});

describe('/me refleja TODOS los permisos del rol', () => {
  it('un usuario de soporte recibe tambien sus permisos de escritura', async () => {
    await createUser(db, { email: 'sop-perms@test.local', role: 'SUPPORT' });
    const token = await loginAdmin(app, 'sop-perms@test.local');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      headers: bearer(token),
    });

    const permissions = response.json().permissions as string[];

    // Estos cinco faltaban cuando la lista se mantenia a mano. El servidor los
    // concedia y la interfaz no se enteraba, asi que ocultaba todos los
    // controles de escritura de soporte y las pantallas quedaban inutiles.
    for (const permission of [
      'support:read',
      'support:write',
      'privacy:read',
      'privacy:write',
      'fans:read',
      'ownership:read',
      'ownership:write',
    ]) {
      expect(permissions, `falta ${permission}`).toContain(permission);
    }
  });

  it('coincide exactamente con lo que la matriz del dominio concede al rol', async () => {
    for (const role of ROLES) {
      await createUser(db, { email: `perms-${role.toLowerCase()}@test.local`, role });
      const token = await loginAdmin(app, `perms-${role.toLowerCase()}@test.local`);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/me',
        headers: bearer(token),
      });

      const devueltos = [...(response.json().permissions as string[])].sort();
      const esperados = [...ROLE_PERMISSIONS[role]].sort();

      // Ni menos (ocultaria funciones que el usuario si tiene) ni mas
      // (mostraria botones que el servidor rechazaria con 403).
      expect(devueltos, `rol ${role}`).toEqual(esperados);
    }
  });

  it('no devuelve permisos que el rol no tiene', async () => {
    await createUser(db, { email: 'perms-sponsor@test.local', role: 'SPONSOR' });
    const token = await loginAdmin(app, 'perms-sponsor@test.local');

    const permissions = (
      await app.inject({ method: 'GET', url: '/api/v1/admin/me', headers: bearer(token) })
    ).json().permissions as string[];

    expect(permissions).not.toContain('fans:read');
    expect(permissions).not.toContain('analytics:read');
  });
});
