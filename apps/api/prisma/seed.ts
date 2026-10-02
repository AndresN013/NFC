/**
 * Datos de demostracion.
 *
 * CLUB FICTICIO a proposito: "Deportivo Andino FC". No se usa ninguna marca,
 * escudo, nombre de club real ni fotografia de jugador real. Los jugadores son
 * inventados. Los colores son genericos.
 *
 * NINGUNA credencial de este archivo es valida fuera de un entorno local.
 * Todas las contrasenas son visibles a proposito para que el equipo pueda
 * entrar; el arranque en produccion aborta si detecta secretos de ejemplo.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { requireRootEnv } from '../src/lib/load-env.js';
import {
  buildQrUrl,
  buildTagUrl,
  generateQrToken,
  generateTagToken,
  generateUnitPublicRef,
  hashToken,
} from '@mev/domain';

// Antes de instanciar Prisma: necesita DATABASE_URL en el entorno, y este guion
// se ejecuta desde `apps/api`, donde no vive el .env.
requireRootEnv('DATABASE_URL');

const db = new PrismaClient();

const PEPPER = process.env.TOKEN_HASH_PEPPER ?? 'dev-only-insecure-pepper-change-me-000000000000';
const FAN_WEB = process.env.FAN_WEB_PUBLIC_URL ?? 'http://localhost:3000';

/** Contrasena comun de las cuentas de demostracion. SOLO desarrollo. */
const DEMO_PASSWORD = 'EscudoVivo2026!';

async function main(): Promise<void> {
  console.log('Sembrando datos de demostracion...');

  // Idempotente: borra en orden inverso de dependencias.
  await resetDemoData();

  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  // --- Organizacion y club ficticio -----------------------------------------

  const organization = await db.organization.create({
    data: { name: 'Marathon Sports (demostracion)', country: 'EC' },
  });

  const club = await db.club.create({
    data: {
      organizationId: organization.id,
      name: 'Deportivo Andino FC',
      slug: 'deportivo-andino',
      // Sin activos de marca: solo colores genericos.
      primaryColor: '#0B3D2E',
      secondaryColor: '#E8C547',
    },
  });

  const season = await db.season.create({
    data: {
      clubId: club.id,
      name: 'Temporada 2026',
      startDate: new Date('2026-02-01'),
      endDate: new Date('2026-11-30'),
    },
  });

  const players = await Promise.all(
    [
      { fullName: 'Mateo Quishpe', shirtNumber: 10, position: 'Mediocampista' },
      { fullName: 'Ariel Zambrano', shirtNumber: 9, position: 'Delantero' },
      { fullName: 'Kevin Chalaco', shirtNumber: 1, position: 'Portero' },
      { fullName: 'Bruno Tapia', shirtNumber: 4, position: 'Defensa' },
    ].map((p) =>
      db.player.create({ data: { ...p, clubId: club.id, seasonId: season.id } }),
    ),
  );

  const modelHome = await db.jerseyModel.create({
    data: {
      clubId: club.id,
      seasonId: season.id,
      name: 'Local 2026',
      edition: 'HOME',
      description: 'Camiseta titular de la temporada 2026, con escudo inteligente.',
    },
  });

  const modelAway = await db.jerseyModel.create({
    data: {
      clubId: club.id,
      seasonId: season.id,
      name: 'Visitante 2026',
      edition: 'AWAY',
      description: 'Camiseta alterna de la temporada 2026.',
    },
  });

  const skus = await Promise.all([
    db.sku.create({
      data: { jerseyModelId: modelHome.id, code: 'AND-HOME-26-S', size: 'S', priceCents: 4990 },
    }),
    db.sku.create({
      data: { jerseyModelId: modelHome.id, code: 'AND-HOME-26-M', size: 'M', priceCents: 4990 },
    }),
    db.sku.create({
      data: { jerseyModelId: modelHome.id, code: 'AND-HOME-26-L', size: 'L', priceCents: 4990 },
    }),
    db.sku.create({
      data: { jerseyModelId: modelAway.id, code: 'AND-AWAY-26-M', size: 'M', priceCents: 4990 },
    }),
  ]);

  await db.match.createMany({
    data: [
      {
        clubId: club.id,
        seasonId: season.id,
        opponent: 'Union Litoral',
        kickoffAt: new Date('2026-03-15T20:00:00Z'),
        venue: 'Estadio Municipal',
        isHome: true,
        phase: 'UPCOMING',
      },
      {
        clubId: club.id,
        seasonId: season.id,
        opponent: 'Atletico Cordillera',
        kickoffAt: new Date('2026-02-20T22:00:00Z'),
        isHome: false,
        phase: 'FINISHED',
        goalsFor: 2,
        goalsAgainst: 1,
      },
    ],
  });

  // --- Usuarios internos, uno por rol ---------------------------------------

  const users = await Promise.all(
    (
      [
        ['super@escudovivo.local', 'Ana Superadmin', 'SUPERADMIN'],
        ['marathon@escudovivo.local', 'Diego Marathon', 'MARATHON_ADMIN'],
        ['club@escudovivo.local', 'Sofia Club', 'CLUB_ADMIN'],
        ['operario@escudovivo.local', 'Luis Operario', 'PRODUCTION_OPERATOR'],
        ['soporte@escudovivo.local', 'Marta Soporte', 'SUPPORT'],
        ['agencia@escudovivo.local', 'Pablo Agencia', 'CONTENT_AGENCY'],
        ['patrocinador@escudovivo.local', 'Rosa Patrocinio', 'SPONSOR'],
      ] as const
    ).map(([email, displayName, role]) =>
      db.user.create({
        data: {
          email,
          displayName,
          passwordHash,
          roleAssignments: {
            create: {
              role,
              // El club y el patrocinador tienen alcance restringido, no global:
              // asi la demostracion ejercita el modelo de alcances de verdad.
              scopeType: role === 'CLUB_ADMIN' ? 'CLUB' : 'GLOBAL',
              scopeId: role === 'CLUB_ADMIN' ? club.id : null,
            },
          },
        },
      }),
    ),
  );

  const operator = users.find((u) => u.email === 'operario@escudovivo.local')!;

  // --- Puesto y telefono autorizado -----------------------------------------

  const station = await db.programmingStation.create({
    data: { code: 'EST-01', name: 'Puesto de emblemas 1', location: 'Planta Quito' },
  });

  await db.authorizedDevice.create({
    data: {
      deviceId: 'demo-device-android-0001',
      label: 'Telefono planta 01',
      model: 'Demostracion',
      osVersion: 'Android 14',
      stationId: station.id,
      primaryOperatorId: operator.id,
    },
  });

  // --- Patrocinador y campana -----------------------------------------------

  const sponsor = await db.sponsor.create({
    data: { organizationId: organization.id, name: 'Hidratacion Andina (ficticio)' },
  });

  const campaign = await db.campaign.create({
    data: {
      sponsorId: sponsor.id,
      name: 'Hinchada 2026',
      startsAt: new Date('2026-02-01'),
      endsAt: new Date('2026-12-31'),
    },
  });

  // Se asigna al patrocinador el alcance de SU campana, no global.
  const sponsorUser = users.find((u) => u.email === 'patrocinador@escudovivo.local')!;
  await db.roleAssignment.deleteMany({ where: { userId: sponsorUser.id } });
  await db.roleAssignment.create({
    data: {
      userId: sponsorUser.id,
      role: 'SPONSOR',
      scopeType: 'CAMPAIGN',
      scopeId: campaign.id,
    },
  });

  // Metricas agregadas de ejemplo. Una con cohorte pequena, para que la
  // supresion sea visible en el panel del patrocinador.
  await db.campaignMetric.createMany({
    data: [
      {
        campaignId: campaign.id,
        metricKey: 'campaign_content_views',
        bucketDate: new Date('2026-03-01'),
        value: 412,
      },
      {
        campaignId: campaign.id,
        metricKey: 'campaign_quiz_completions',
        bucketDate: new Date('2026-03-01'),
        value: 87,
      },
      {
        campaignId: campaign.id,
        metricKey: 'campaign_reward_redemptions',
        bucketDate: new Date('2026-03-01'),
        // Por debajo del minimo de cohorte: la API lo devolvera como null.
        value: 6,
      },
    ],
  });

  // --- Contenido dinamico ---------------------------------------------------

  await createContent(club.id, season.id, modelHome.id, players[0]!.id, campaign.id);

  // --- Recompensas ----------------------------------------------------------

  await db.reward.createMany({
    data: [
      {
        campaignId: campaign.id,
        name: 'Fondo de pantalla exclusivo',
        description: 'Descarga el fondo de pantalla de la temporada.',
        kind: 'CONTENT_UNLOCK',
        minTrustLevel: 'IDENTIFIED_ONLY',
        requiresAccount: true,
        active: true,
      },
      {
        campaignId: campaign.id,
        name: 'Sorteo de camiseta firmada',
        description: 'Participa en el sorteo mensual.',
        kind: 'RAFFLE_ENTRY',
        // Exige el nivel mas alto: con NTAG 21x nadie lo alcanza todavia, y eso
        // es correcto. La recompensa queda lista para cuando haya NTAG 424 DNA.
        minTrustLevel: 'VERIFIED',
        requiresAccount: true,
        stock: 100,
        active: true,
      },
    ],
  });

  // --- Lotes y orden de produccion ------------------------------------------

  const order = await db.productionOrder.create({
    data: {
      organizationId: organization.id,
      code: 'OP-2026-0001',
      state: 'IN_PROGRESS',
      plannedUnits: 1000,
      notes: 'Piloto de 1.000 jerseys, temporada 2026.',
    },
  });

  const batch = await db.productionBatch.create({
    data: {
      productionOrderId: order.id,
      code: 'LOTE-NTAG213-A',
      supplierName: 'Proveedor de demostracion',
      supplierLotRef: 'DEMO-LOT-0001',
    },
  });

  // Un segundo lote MARCADO, para que el motor de riesgo tenga algo que senalar.
  const flaggedBatch = await db.productionBatch.create({
    data: {
      productionOrderId: order.id,
      code: 'LOTE-NTAG213-B',
      supplierName: 'Proveedor de demostracion',
      flagged: true,
      flagReason: 'Control de calidad detecto variacion de adhesivo en el lote.',
    },
  });

  // --- Unidades de demostracion en distintos estados ------------------------

  const demoTokens: { label: string; url: string }[] = [];

  /** Unidad activada y sin dueno: sirve para probar el reclamo. */
  const activated = await createUnit({
    label: 'ACTIVADA sin titular',
    batchId: batch.id,
    orderId: order.id,
    modelId: modelHome.id,
    skuId: skus[1]!.id,
    playerId: players[0]!.id,
    shirtNumber: 10,
    chipState: 'ACTIVATED',
    unitState: 'ACTIVATED',
    uid: '04A1B2C3D4E580',
    emblemCode: 'EMB-000001',
    activated: true,
    tokens: demoTokens,
  });

  /** Unidad vendida con titular: sirve para probar transferencia e historial. */
  const owned = await createUnit({
    label: 'VENDIDA con titular',
    batchId: batch.id,
    orderId: order.id,
    modelId: modelHome.id,
    skuId: skus[2]!.id,
    playerId: players[1]!.id,
    shirtNumber: 9,
    chipState: 'ACTIVATED',
    unitState: 'SOLD',
    uid: '04A1B2C3D4E581',
    emblemCode: 'EMB-000002',
    activated: true,
    tokens: demoTokens,
  });

  /** Unidad aun en produccion: debe devolver NOT_ACTIVATED al verificarse. */
  await createUnit({
    label: 'EN PRODUCCION (esperado: NOT_ACTIVATED)',
    batchId: batch.id,
    orderId: order.id,
    modelId: modelHome.id,
    skuId: skus[0]!.id,
    chipState: 'READY_FOR_HEAT_PRESS',
    unitState: 'IN_PRODUCTION',
    uid: '04A1B2C3D4E582',
    emblemCode: 'EMB-000003',
    activated: false,
    tokens: demoTokens,
  });

  /** Unidad revocada: debe devolver REVOKED. */
  await createUnit({
    label: 'REVOCADA (esperado: REVOKED)',
    batchId: batch.id,
    orderId: order.id,
    modelId: modelAway.id,
    skuId: skus[3]!.id,
    chipState: 'REVOKED',
    unitState: 'REVOKED',
    uid: '04A1B2C3D4E583',
    emblemCode: 'EMB-000004',
    activated: true,
    revokeReason: 'Devolucion por defecto de fabrica.',
    tokens: demoTokens,
  });

  /** Unidad del lote marcado: aporta puntuacion de riesgo al verificarse. */
  await createUnit({
    label: 'ACTIVADA en lote marcado',
    batchId: flaggedBatch.id,
    orderId: order.id,
    modelId: modelHome.id,
    skuId: skus[1]!.id,
    chipState: 'ACTIVATED',
    unitState: 'ACTIVATED',
    uid: '04A1B2C3D4E584',
    emblemCode: 'EMB-000005',
    activated: true,
    tokens: demoTokens,
  });

  /** Unidad en cuarentena: debe devolver SUSPICIOUS. */
  await createUnit({
    label: 'EN CUARENTENA (esperado: SUSPICIOUS)',
    batchId: flaggedBatch.id,
    orderId: order.id,
    modelId: modelHome.id,
    skuId: skus[2]!.id,
    chipState: 'QUARANTINED',
    unitState: 'QUARANTINED',
    uid: '04A1B2C3D4E585',
    emblemCode: 'EMB-000006',
    activated: true,
    tokens: demoTokens,
  });

  // --- Aficionados de demostracion ------------------------------------------

  const fanPasswordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const fan = await db.fanAccount.create({
    data: {
      email: 'hincha@escudovivo.local',
      passwordHash: fanPasswordHash,
      displayName: 'Camila Hincha',
      locale: 'es',
      loyaltyTier: 2,
      emailVerifiedAt: new Date(),
      consents: {
        create: [
          {
            purpose: 'MARKETING',
            granted: true,
            grantedAt: new Date(),
            policyVersion: '2026-01',
          },
          // Ubicacion y patrocinadores DENEGADOS a proposito: la demostracion
          // debe mostrar que el contenido geografico y patrocinado no aparece.
          { purpose: 'LOCATION', granted: false, revokedAt: new Date(), policyVersion: '2026-01' },
          {
            purpose: 'SPONSOR_ANALYTICS',
            granted: false,
            revokedAt: new Date(),
            policyVersion: '2026-01',
          },
        ],
      },
    },
  });

  const secondFan = await db.fanAccount.create({
    data: {
      email: 'hincha2@escudovivo.local',
      passwordHash: fanPasswordHash,
      displayName: 'Jorge Hincha',
      locale: 'es',
      emailVerifiedAt: new Date(),
    },
  });

  await db.ownership.create({
    data: { jerseyUnitId: owned.unitId, fanId: fan.id, acquiredVia: 'CLAIM' },
  });

  // --- Caso de soporte y solicitud de privacidad de ejemplo -----------------

  await db.supportCase.create({
    data: {
      contactEmail: 'hincha@escudovivo.local',
      fanId: fan.id,
      jerseyUnitId: owned.unitId,
      reason: 'NFC_NOT_READING',
      subject: 'El escudo no responde con mi telefono',
      description:
        'Tengo un iPhone 11 y al acercarlo al escudo no ocurre nada. Con el telefono de mi hermano si funciona.',
    },
  });

  await db.privacyRequest.create({
    data: {
      email: 'hincha2@escudovivo.local',
      fanId: secondFan.id,
      type: 'ACCESS',
      details: 'Solicito copia de los datos que tienen asociados a mi correo.',
      dueAt: new Date(Date.now() + 15 * 86_400_000),
    },
  });

  // --- Resumen --------------------------------------------------------------

  console.log('\n=== Datos de demostracion listos ===\n');
  console.log('Club ficticio: Deportivo Andino FC (ninguna marca real)');
  console.log(`\nContrasena de TODAS las cuentas de demostracion: ${DEMO_PASSWORD}`);
  console.log('\nUsuarios del panel:');
  for (const u of users) console.log(`  ${u.email}`);
  console.log('\nAficionados:');
  console.log('  hincha@escudovivo.local  (titular de una prenda)');
  console.log('  hincha2@escudovivo.local (sin prendas)');
  console.log('\nTelefono autorizado para la app Android:');
  console.log('  deviceId: demo-device-android-0001');
  console.log(`\nOrden de produccion: ${order.code}`);
  console.log('\nURLs de verificacion de demostracion:');
  console.log('(equivalen a acercar el telefono a cada emblema)\n');
  for (const t of demoTokens) console.log(`  ${t.label}\n    ${t.url}\n`);
  console.log(
    'ADVERTENCIA: el proveedor NFC activo es una SIMULACION. Ninguna de estas\n' +
      'verificaciones constituye autenticacion criptografica real.\n',
  );
  console.log(`Unidad activada sin titular (para probar reclamo): ${activated.publicRef}`);
}

// ---------------------------------------------------------------------------

async function resetDemoData(): Promise<void> {
  // Orden inverso de dependencias. `deleteMany` sin filtro vacia la tabla.
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

interface CreateUnitInput {
  label: string;
  batchId: string;
  orderId: string;
  modelId: string;
  skuId: string;
  playerId?: string;
  shirtNumber?: number;
  chipState: Prisma.NfcChipCreateInput['state'];
  unitState: Prisma.JerseyUnitCreateInput['state'];
  uid: string;
  emblemCode: string;
  activated: boolean;
  revokeReason?: string;
  tokens: { label: string; url: string }[];
}

async function createUnit(input: CreateUnitInput): Promise<{ unitId: string; publicRef: string }> {
  const tagToken = generateTagToken();
  const qrToken = generateQrToken();
  const now = new Date('2026-02-10T15:00:00Z');

  const chip = await db.nfcChip.create({
    data: {
      uid: input.uid,
      chipType: 'NTAG213',
      state: input.chipState,
      batchId: input.batchId,
      tagTokenHash: hashToken(tagToken, PEPPER),
      programmedAt: now,
      verifiedAt: now,
      activatedAt: input.activated ? now : null,
      revokedAt: input.chipState === 'REVOKED' ? now : null,
      revokeReason: input.revokeReason ?? null,
    },
  });

  // Referencia de clave de ejemplo: demuestra la forma sin contener una clave.
  await db.nfcKeyReference.create({
    data: {
      chipId: chip.id,
      keyRole: 'APP_MASTER',
      reference: 'PLACEHOLDER-sin-custodio-configurado',
      custodian: 'none',
      version: 1,
    },
  });

  const emblem = await db.emblem.create({
    data: { code: input.emblemCode, chipId: chip.id, batchId: input.batchId },
  });

  const publicRef = generateUnitPublicRef();

  const unit = await db.jerseyUnit.create({
    data: {
      jerseyModelId: input.modelId,
      skuId: input.skuId,
      playerId: input.playerId ?? null,
      shirtNumber: input.shirtNumber ?? null,
      emblemId: emblem.id,
      productionOrderId: input.orderId,
      publicRef,
      qrTokenHash: hashToken(qrToken, PEPPER),
      state: input.unitState,
      activatedAt: input.activated ? now : null,
      revokedAt: input.unitState === 'REVOKED' ? now : null,
      revokeReason: input.revokeReason ?? null,
      interactionCount: input.activated ? 3 : 0,
    },
  });

  if (input.activated && input.unitState !== 'REVOKED') {
    await db.digitalCertificate.create({
      data: {
        jerseyUnitId: unit.id,
        serial: `CERT-${publicRef.replace('MEV-', '')}`,
        issuedAt: now,
        // Sin firma: no hay clave custodiada en el MVP.
        signature: null,
      },
    });
  }

  await db.postPressCheck.create({
    data: {
      jerseyUnitId: unit.id,
      passed: true,
      readable: true,
      contentIntact: true,
      temperatureC: 150,
      pressureBar: 3.5,
      durationSec: 15,
      providerId: 'mock',
      // Marcado como simulado: NO fue una prueba fisica real.
      simulated: true,
      detail: 'SIMULACION: prueba de demostracion, no se aplico calor real.',
    },
  });

  input.tokens.push(
    { label: `${input.label} - NFC`, url: buildTagUrl(FAN_WEB, tagToken) },
    { label: `${input.label} - QR de respaldo`, url: buildQrUrl(FAN_WEB, qrToken) },
  );

  return { unitId: unit.id, publicRef };
}

async function createContent(
  clubId: string,
  seasonId: string,
  modelId: string,
  playerId: string,
  campaignId: string,
): Promise<void> {
  const items: {
    kind: Prisma.ContentItemCreateInput['kind'];
    title: Record<string, string>;
    body: Record<string, string>;
    priority: number;
    conditions: Record<string, unknown>;
    campaignId?: string;
    estimatedMediaBytes?: number;
    mediaUrl?: string;
    mediaAlt?: Record<string, string>;
  }[] = [
    {
      kind: 'HERO',
      title: { es: 'Bienvenido a la hinchada', en: 'Welcome to the stands' },
      body: {
        es: 'Este escudo guarda la historia de tu camiseta. Gracias por llevarla.',
        en: 'This crest holds your jersey story. Thanks for wearing it.',
      },
      priority: 100,
      conditions: { clubIds: [clubId] },
    },
    {
      kind: 'MATCH_CARD',
      title: { es: 'Proximo partido', en: 'Next match' },
      body: {
        es: 'Deportivo Andino FC recibe a Union Litoral el 15 de marzo.',
        en: 'Deportivo Andino FC hosts Union Litoral on March 15.',
      },
      priority: 90,
      conditions: { clubIds: [clubId], matchPhases: ['UPCOMING'] },
    },
    {
      kind: 'STORY',
      title: { es: 'La camiseta del 10', en: 'The number 10 shirt' },
      body: {
        es: 'El dorsal 10 lo lleva Mateo Quishpe esta temporada.',
        en: 'Mateo Quishpe wears number 10 this season.',
      },
      priority: 80,
      // Solo aparece en camisetas con el dorsal 10.
      conditions: { clubIds: [clubId], shirtNumbers: [10], playerIds: [playerId] },
    },
    {
      kind: 'QUIZ',
      title: { es: 'Trivia del hincha', en: 'Fan trivia' },
      body: {
        es: 'Responde tres preguntas sobre la temporada y desbloquea contenido.',
        en: 'Answer three questions about the season to unlock content.',
      },
      priority: 70,
      // Solo para quien ya interactuo varias veces: premia la fidelidad.
      conditions: { clubIds: [clubId], minInteractions: 2 },
    },
    {
      kind: 'VIDEO',
      title: { es: 'Detras del diseno', en: 'Behind the design' },
      body: { es: 'Como se diseno la camiseta local 2026.', en: 'How the 2026 home kit was designed.' },
      priority: 60,
      conditions: { clubIds: [clubId], jerseyModelIds: [modelId], seasonIds: [seasonId] },
      // Medio pesado: se omite en modo de bajo consumo de datos.
      mediaUrl: '/demo/video-placeholder.mp4',
      mediaAlt: { es: 'Video del proceso de diseno', en: 'Design process video' },
      estimatedMediaBytes: 8_400_000,
    },
    {
      kind: 'CARE_INSTRUCTIONS',
      title: { es: 'Cuidado del escudo', en: 'Crest care' },
      body: {
        es: 'Lave la prenda al reves, con agua fria. No planche sobre el escudo.',
        en: 'Wash inside out in cold water. Do not iron over the crest.',
      },
      priority: 40,
      conditions: {},
    },
    {
      kind: 'SPONSOR_MESSAGE',
      title: { es: 'Hidratacion Andina', en: 'Hidratacion Andina' },
      body: {
        es: 'Mensaje de nuestro patrocinador. Solo se muestra con su consentimiento.',
        en: 'Sponsor message. Shown only with your consent.',
      },
      priority: 50,
      conditions: { clubIds: [clubId] },
      campaignId,
    },
    {
      kind: 'STORY',
      title: { es: 'Hinchas en Ecuador', en: 'Fans in Ecuador' },
      body: {
        es: 'Contenido para quienes leen desde Ecuador. Requiere consentimiento de ubicacion.',
        en: 'Content for readers in Ecuador. Requires location consent.',
      },
      priority: 30,
      // Condicion geografica: sin consentimiento de ubicacion NO aparece.
      conditions: { clubIds: [clubId], countryCodes: ['EC'] },
    },
  ];

  for (const item of items) {
    await db.contentItem.create({
      data: {
        clubId,
        campaignId: item.campaignId ?? null,
        kind: item.kind,
        title: item.title,
        body: item.body,
        mediaUrl: item.mediaUrl ?? null,
        mediaAlt: item.mediaAlt ?? null,
        estimatedMediaBytes: item.estimatedMediaBytes ?? null,
        priority: item.priority,
        rules: { create: { conditions: item.conditions as Prisma.InputJsonValue } },
      },
    });
  }
}

main()
  .catch((error) => {
    console.error('Error al sembrar datos:', error);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
