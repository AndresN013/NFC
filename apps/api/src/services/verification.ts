import type { PrismaClient, Prisma } from '@prisma/client';
import {
  evaluateRisk,
  hashToken,
  maskPublicRef,
  shouldOpenRiskAlert,
  type RiskAssessment,
  type RiskEvaluationInput,
  type TrustLevel,
  type VerificationMethod,
  type ChipType,
  type ChipState,
  type JerseyUnitState,
} from '@mev/domain';
import type { RequestContext } from '../lib/request-context.js';
import { fingerprintMessage } from '../lib/request-context.js';

/**
 * Servicio de verificacion.
 *
 * Es el unico camino por el que una lectura publica produce un veredicto. Todas
 * las rutas publicas (NFC y QR) desembocan aqui.
 *
 * GARANTIAS
 *  - Siempre se registra un VerificationEvent, incluso cuando el token es
 *    desconocido: si no, un atacante que enumera no dejaria rastro.
 *  - La respuesta publica se construye con una lista blanca de campos. Nunca se
 *    serializa una entidad de la base de datos directamente.
 *  - El tiempo de respuesta no depende de si el token existe (ver `lookupUnit`).
 */

export interface VerifyInput {
  method: VerificationMethod;
  /** Token presentado: el del chip o el del QR, segun `method`. */
  token: string;
  /** Mensaje autenticado producido por el chip, si lo hubo. */
  authenticatedMessage?: string | null;
  /** Contador reportado por el chip, si lo hubo. */
  reportedCounter?: number | null;
  /** `true` si la evidencia proviene de un proveedor simulado. */
  simulated?: boolean;
  context: RequestContext;
}

/** Respuesta publica. Lista blanca explicita: nada mas sale de aqui. */
export interface PublicVerificationResult {
  trustLevel: TrustLevel;
  message: { titulo: string; explicacion: string; tono: string };
  /** Identificador parcialmente oculto. Nunca el completo. */
  maskedRef: string | null;
  unit: PublicUnitSummary | null;
  /** Acciones que la interfaz debe ofrecer. */
  actions: string[];
  /** Referencia del evento, para que soporte pueda localizar la lectura. */
  eventRef: string;
  /** `true` cuando la lectura se produjo con un proveedor simulado. */
  simulated: boolean;
}

export interface PublicUnitSummary {
  club: string;
  clubSlug: string;
  /** Colores del club, para que la pagina del aficionado se sienta suya. */
  clubColors: { primary: string; secondary: string };
  season: string;
  model: string;
  edition: string;
  playerName: string | null;
  shirtNumber: number | null;
  activatedAt: string | null;
  condition: string;
  /** `true` si la unidad no tiene propietario y puede reclamarse. */
  claimable: boolean;
  /** Identificador opaco de la unidad para las siguientes llamadas de la web. */
  unitHandle: string;
}

/**
 * Datos internos completos que devuelve la verificacion, para uso del servidor.
 * NUNCA se serializa a un cliente publico.
 */
export interface InternalVerificationResult {
  assessment: RiskAssessment;
  unitId: string | null;
  chipId: string | null;
  eventId: string;
  public: PublicVerificationResult;
}

export async function verifyPresentedToken(
  db: PrismaClient,
  input: VerifyInput,
  config: { pepper: string },
): Promise<InternalVerificationResult> {
  const tokenHash = hashToken(input.token, config.pepper);

  const unit =
    input.method === 'QR_CODE'
      ? await findUnitByQrToken(db, tokenHash)
      : await findUnitByTagToken(db, tokenHash);

  const now = new Date();

  const messageFingerprint = input.authenticatedMessage
    ? fingerprintMessage(input.authenticatedMessage, config.pepper)
    : null;

  const history = await buildHistory(db, {
    unitId: unit?.id ?? null,
    chipLastCounter: unit?.chipLastCounter ?? null,
    messageFingerprint,
    now,
  });

  const evaluation: RiskEvaluationInput = {
    method: input.method,
    unit: unit
      ? {
          chipType: (unit.chipType ?? 'UNKNOWN') as ChipType,
          chipState: (unit.chipState ?? 'RECEIVED') as ChipState,
          unitState: unit.state as JerseyUnitState,
          activatedAt: unit.activatedAt,
          activeOwnerCount: unit.activeOwnerCount,
          batchFlagged: unit.batchFlagged,
        }
      : null,
    crypto:
      input.method === 'NFC_CRYPTOGRAPHIC'
        ? {
            // El adaptador NTAG 424 DNA no esta implementado, asi que hoy
            // ninguna ruta produce `signatureValid: true` con `simulated: false`.
            // Cuando exista, la validacion del CMAC ocurrira aqui, en servidor.
            signatureValid: false,
            readCounter: input.reportedCounter ?? null,
            simulated: input.simulated ?? true,
          }
        : null,
    history,
    currentLocation: input.context.countryCode ? { countryCode: input.context.countryCode } : null,
    now,
  };

  const assessment = evaluateRisk(evaluation);

  // El evento se registra SIEMPRE, tambien cuando el token es desconocido.
  const event = await db.verificationEvent.create({
    data: {
      jerseyUnitId: unit?.id ?? null,
      chipId: unit?.chipId ?? null,
      method: input.method,
      trustLevel: assessment.trustLevel,
      riskLevel: assessment.riskLevel,
      riskScore: assessment.riskScore,
      reasonCodes: assessment.reasonCodes.join(','),
      reportedCounter: input.reportedCounter ?? null,
      messageFingerprint,
      ipPseudonym: input.context.ipPseudonym,
      deviceFingerprint: input.context.deviceFingerprint,
      countryCode: input.context.countryCode,
      language: input.context.language,
      simulated: input.simulated ?? false,
    },
    select: { id: true },
  });

  if (unit) {
    await Promise.all([
      db.jerseyUnit.update({
        where: { id: unit.id },
        data: { interactionCount: { increment: 1 } },
      }),
      // El contador solo avanza si la lectura NO fue sospechosa: aceptar el
      // contador de una lectura sospechosa dejaria que un atacante lo empujara
      // hacia adelante y bloqueara al chip legitimo.
      input.reportedCounter != null &&
      unit.chipId &&
      assessment.trustLevel === 'VERIFIED' &&
      (unit.chipLastCounter == null || input.reportedCounter > unit.chipLastCounter)
        ? db.nfcChip.update({
            where: { id: unit.chipId },
            data: { lastAcceptedCounter: input.reportedCounter },
          })
        : Promise.resolve(),
    ]);
  }

  if (shouldOpenRiskAlert(assessment) && assessment.trustLevel !== 'NOT_ACTIVATED') {
    await openRiskAlert(db, {
      unitId: unit?.id ?? null,
      eventId: event.id,
      assessment,
    });
  }

  return {
    assessment,
    unitId: unit?.id ?? null,
    chipId: unit?.chipId ?? null,
    eventId: event.id,
    public: buildPublicResult(assessment, unit, event.id, input.simulated ?? false),
  };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

interface UnitLookup {
  id: string;
  publicRef: string;
  state: string;
  activatedAt: Date | null;
  condition: string;
  chipId: string | null;
  chipType: string | null;
  chipState: string | null;
  chipLastCounter: number | null;
  batchFlagged: boolean;
  activeOwnerCount: number;
  club: string;
  clubSlug: string;
  clubPrimary: string;
  clubSecondary: string;
  season: string;
  model: string;
  edition: string;
  playerName: string | null;
  shirtNumber: number | null;
}

const UNIT_INCLUDE = {
  jerseyModel: { include: { club: true, season: true } },
  player: true,
  emblem: { include: { chip: { include: { batch: true } } } },
  ownerships: { where: { endedAt: null }, select: { id: true } },
} satisfies Prisma.JerseyUnitInclude;

type UnitWithRelations = Prisma.JerseyUnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

function toLookup(unit: UnitWithRelations): UnitLookup {
  const chip = unit.emblem?.chip ?? null;
  return {
    id: unit.id,
    publicRef: unit.publicRef,
    state: unit.state,
    activatedAt: unit.activatedAt,
    condition: unit.condition,
    chipId: chip?.id ?? null,
    chipType: chip?.chipType ?? null,
    chipState: chip?.state ?? null,
    chipLastCounter: chip?.lastAcceptedCounter ?? null,
    batchFlagged: chip?.batch?.flagged ?? false,
    activeOwnerCount: unit.ownerships.length,
    club: unit.jerseyModel.club.name,
    clubSlug: unit.jerseyModel.club.slug,
    clubPrimary: unit.jerseyModel.club.primaryColor,
    clubSecondary: unit.jerseyModel.club.secondaryColor,
    season: unit.jerseyModel.season.name,
    model: unit.jerseyModel.name,
    edition: unit.jerseyModel.edition,
    playerName: unit.player?.fullName ?? unit.playerNameOnShirt ?? null,
    shirtNumber: unit.shirtNumber ?? unit.player?.shirtNumber ?? null,
  };
}

async function findUnitByTagToken(
  db: PrismaClient,
  tokenHash: string,
): Promise<UnitLookup | null> {
  const chip = await db.nfcChip.findUnique({
    where: { tagTokenHash: tokenHash },
    select: { emblem: { select: { jerseyUnit: { select: { id: true } } } } },
  });

  const unitId = chip?.emblem?.jerseyUnit?.id;
  if (!unitId) return null;

  const unit = await db.jerseyUnit.findUnique({ where: { id: unitId }, include: UNIT_INCLUDE });
  return unit ? toLookup(unit) : null;
}

async function findUnitByQrToken(db: PrismaClient, tokenHash: string): Promise<UnitLookup | null> {
  const unit = await db.jerseyUnit.findUnique({
    where: { qrTokenHash: tokenHash },
    include: UNIT_INCLUDE,
  });

  if (!unit) return null;

  // Un QR caducado se trata como desconocido: la rotacion debe surtir efecto.
  if (unit.qrExpiresAt && unit.qrExpiresAt < new Date()) return null;

  return toLookup(unit);
}

async function buildHistory(
  db: PrismaClient,
  params: {
    unitId: string | null;
    chipLastCounter: number | null;
    messageFingerprint: string | null;
    now: Date;
  },
) {
  if (!params.unitId) {
    return {
      lastAcceptedCounter: null,
      readsLastHour: 0,
      readsLast24h: 0,
      distinctDevices24h: 0,
      distinctIps24h: 0,
      lastLocation: null,
      lastLocationAt: null,
      messageAlreadySeen: false,
    };
  }

  const oneHourAgo = new Date(params.now.getTime() - 3_600_000);
  const dayAgo = new Date(params.now.getTime() - 86_400_000);

  const [readsLastHour, recentEvents, lastLocated, replay] = await Promise.all([
    db.verificationEvent.count({
      where: { jerseyUnitId: params.unitId, createdAt: { gte: oneHourAgo } },
    }),
    db.verificationEvent.findMany({
      where: { jerseyUnitId: params.unitId, createdAt: { gte: dayAgo } },
      select: { deviceFingerprint: true, ipPseudonym: true },
    }),
    db.verificationEvent.findFirst({
      where: { jerseyUnitId: params.unitId, countryCode: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { countryCode: true, createdAt: true },
    }),
    params.messageFingerprint
      ? db.verificationEvent.findFirst({
          where: { messageFingerprint: params.messageFingerprint },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    lastAcceptedCounter: params.chipLastCounter,
    readsLastHour,
    readsLast24h: recentEvents.length,
    distinctDevices24h: new Set(
      recentEvents.map((e) => e.deviceFingerprint).filter(Boolean),
    ).size,
    distinctIps24h: new Set(recentEvents.map((e) => e.ipPseudonym).filter(Boolean)).size,
    lastLocation: lastLocated?.countryCode ? { countryCode: lastLocated.countryCode } : null,
    lastLocationAt: lastLocated?.createdAt ?? null,
    messageAlreadySeen: replay != null,
  };
}

async function openRiskAlert(
  db: PrismaClient,
  params: { unitId: string | null; eventId: string; assessment: RiskAssessment },
): Promise<void> {
  // Se evita el ruido: si ya hay una alerta abierta para esta unidad con el
  // mismo motivo, no se crea otra. Un atacante que repite la lectura no debe
  // poder inundar la bandeja de soporte.
  if (params.unitId) {
    const existing = await db.riskAlert.findFirst({
      where: {
        jerseyUnitId: params.unitId,
        state: { in: ['OPEN', 'IN_REVIEW'] },
        reasonCodes: params.assessment.reasonCodes.join(','),
      },
      select: { id: true },
    });
    if (existing) return;
  }

  await db.riskAlert.create({
    data: {
      jerseyUnitId: params.unitId,
      verificationEventId: params.eventId,
      riskLevel: params.assessment.riskLevel,
      reasonCodes: params.assessment.reasonCodes.join(','),
      summary: buildAlertSummary(params.assessment),
    },
  });
}

function buildAlertSummary(assessment: RiskAssessment): string {
  const top = assessment.findings
    .filter((f) => f.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => f.detail);
  return top.length > 0
    ? top.join(' | ')
    : `Resultado ${assessment.trustLevel} con puntuacion ${assessment.riskScore}`;
}

// ---------------------------------------------------------------------------
// Construccion de la respuesta publica
// ---------------------------------------------------------------------------

/**
 * Niveles en los que se revelan los datos del producto.
 * Un token revocado o no activado NO devuelve la ficha: si lo hiciera, quien
 * roba un lote de emblemas podria consultar a que modelo pertenece cada uno.
 */
const LEVELS_WITH_PRODUCT_DETAIL: readonly TrustLevel[] = ['VERIFIED', 'IDENTIFIED_ONLY'];

function buildPublicResult(
  assessment: RiskAssessment,
  unit: UnitLookup | null,
  eventId: string,
  simulated: boolean,
): PublicVerificationResult {
  const showDetail = unit != null && LEVELS_WITH_PRODUCT_DETAIL.includes(assessment.trustLevel);

  return {
    trustLevel: assessment.trustLevel,
    message: assessment.userMessage,
    maskedRef: unit && assessment.trustLevel !== 'UNVERIFIABLE' ? maskPublicRef(unit.publicRef) : null,
    unit: showDetail
      ? {
          club: unit.club,
          clubSlug: unit.clubSlug,
          clubColors: { primary: unit.clubPrimary, secondary: unit.clubSecondary },
          season: unit.season,
          model: unit.model,
          edition: unit.edition,
          playerName: unit.playerName,
          shirtNumber: unit.shirtNumber,
          activatedAt: unit.activatedAt?.toISOString() ?? null,
          condition: unit.condition,
          claimable: unit.activeOwnerCount === 0,
          unitHandle: unit.id,
        }
      : null,
    // Las acciones internas no se exponen: se filtran a las que la interfaz usa.
    actions: assessment.recommendedActions.filter(
      (a) => !['OPEN_RISK_ALERT', 'REQUIRE_HUMAN_REVIEW'].includes(a),
    ),
    eventRef: eventId,
    simulated,
  };
}
