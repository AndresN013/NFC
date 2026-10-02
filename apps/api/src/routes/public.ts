import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CONSENT_COPY,
  CONSENT_PURPOSES,
  contentItemMatches,
  hasActiveConsent,
  maskPublicRef,
  PRIVACY_REQUEST_SLA_DAYS,
  resolveContent,
  filterSponsoredContent,
  type ContentContext,
  type ContentItem,
  type MatchPhase,
  type MatchResult,
  type TrustLevel,
  type UnitCondition,
} from '@mev/domain';
import { buildRequestContext } from '../lib/request-context.js';
import { notFound } from '../lib/errors.js';
import { verifyPresentedToken } from '../services/verification.js';
import { recordAudit } from '../lib/audit.js';

/**
 * Rutas publicas: no requieren cuenta ni consentimiento.
 *
 * Verificar un jersey es la funcion central del producto y debe funcionar para
 * cualquiera, sin registrarse y sin aceptar nada. Ninguna ruta de este archivo
 * exige sesion.
 */

const verifyBody = z.object({
  method: z.enum(['NFC_CRYPTOGRAPHIC', 'NFC_STATIC_URL', 'QR_CODE']),
  token: z.string().min(8).max(256),
  authenticatedMessage: z.string().max(512).nullish(),
  reportedCounter: z.number().int().nonnegative().max(16_777_215).nullish(),
});

export default async function publicRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;

  /**
   * Verificacion. Es el punto de entrada de la URL grabada en el chip y del QR.
   *
   * Rate limiting por IP: la proteccion real contra enumeracion. El espacio de
   * tokens (256 bits) ya hace inviable adivinarlos, pero el limite evita que
   * alguien use este endpoint como oraculo o como amplificador de carga.
   */
  app.post(
    '/verify',
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_VERIFY_PER_MINUTE,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['publico'],
        summary: 'Verifica un identificador presentado por NFC o QR',
        body: {
          type: 'object',
          required: ['method', 'token'],
          properties: {
            method: { type: 'string', enum: ['NFC_CRYPTOGRAPHIC', 'NFC_STATIC_URL', 'QR_CODE'] },
            token: { type: 'string' },
            authenticatedMessage: { type: ['string', 'null'] },
            reportedCounter: { type: ['integer', 'null'] },
          },
        },
      },
    },
    async (request) => {
      const body = verifyBody.parse(request.body);
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const result = await verifyPresentedToken(
        db,
        {
          method: body.method,
          token: body.token,
          authenticatedMessage: body.authenticatedMessage ?? null,
          reportedCounter: body.reportedCounter ?? null,
          // Hoy ninguna ruta puede producir evidencia criptografica real: el
          // adaptador NTAG 424 DNA no esta implementado. Se marca como simulada
          // para que el motor de riesgo no pueda emitir VERIFIED por error.
          simulated: config.NFC_PROVIDER === 'mock',
          context,
        },
        { pepper: config.TOKEN_HASH_PEPPER },
      );

      return result.public;
    },
  );

  /**
   * Certificado digital de una unidad.
   * Solo se emite para unidades activadas: un certificado de una unidad aun en
   * produccion seria un documento valido para un jersey que no se ha vendido.
   */
  app.get(
    '/units/:handle/certificate',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['publico'], summary: 'Certificado digital de una unidad' },
    },
    async (request) => {
      const { handle } = z.object({ handle: z.string().uuid() }).parse(request.params);

      const unit = await db.jerseyUnit.findFirst({
        where: { id: handle, state: { in: ['ACTIVATED', 'SOLD'] }, deletedAt: null },
        include: {
          jerseyModel: { include: { club: true, season: true } },
          player: true,
          certificate: true,
          sku: true,
        },
      });

      if (!unit) throw notFound('No encontramos un certificado para este producto');

      // Lista blanca de campos. Nunca se serializa la entidad completa.
      return {
        serial: unit.certificate?.serial ?? null,
        issuedAt: unit.certificate?.issuedAt?.toISOString() ?? null,
        revokedAt: unit.certificate?.revokedAt?.toISOString() ?? null,
        maskedRef: maskPublicRef(unit.publicRef),
        club: unit.jerseyModel.club.name,
        season: unit.jerseyModel.season.name,
        model: unit.jerseyModel.name,
        edition: unit.jerseyModel.edition,
        size: unit.sku?.size ?? null,
        playerName: unit.player?.fullName ?? unit.playerNameOnShirt ?? null,
        shirtNumber: unit.shirtNumber ?? unit.player?.shirtNumber ?? null,
        activatedAt: unit.activatedAt?.toISOString() ?? null,
        condition: unit.condition,
        /**
         * Advertencia obligatoria: el certificado acredita el registro, no la
         * autenticidad criptografica. Con NTAG 21x no existe tal prueba.
         */
        disclaimer:
          'Este certificado acredita que la unidad esta registrada en la plataforma de Marathon. ' +
          'El nivel de confianza de cada lectura depende del metodo utilizado y se indica al verificar.',
      };
    },
  );

  /**
   * Contenido dinamico de una unidad.
   * Anonimo por defecto. Si llega una sesion de aficionado se aplican sus
   * consentimientos; sin sesion, se asume que NO hay consentimiento.
   */
  app.get(
    '/units/:handle/content',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: [app.optionalFan],
      schema: { tags: ['publico'], summary: 'Contenido dinamico aplicable a una unidad' },
    },
    async (request) => {
      const { handle } = z.object({ handle: z.string().uuid() }).parse(request.params);
      const query = z
        .object({ trustLevel: z.string().optional(), lowData: z.string().optional() })
        .parse(request.query);

      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const unit = await db.jerseyUnit.findFirst({
        where: { id: handle, deletedAt: null },
        include: { jerseyModel: { include: { club: true, season: true } }, player: true },
      });
      if (!unit) throw notFound('Producto no encontrado');

      const fan = request.currentFan;
      const consents = fan
        ? await db.consent.findMany({ where: { fanId: fan.id } })
        : [];

      const consentRecords = consents.map((c) => ({
        purpose: c.purpose,
        granted: c.granted,
        grantedAt: c.grantedAt,
        revokedAt: c.revokedAt,
        policyVersion: c.policyVersion,
      }));

      const locationConsent = hasActiveConsent(consentRecords, 'LOCATION');
      const sponsorConsent = hasActiveConsent(consentRecords, 'SPONSOR_ANALYTICS');

      const nextMatch = await db.match.findFirst({
        where: { clubId: unit.jerseyModel.clubId },
        orderBy: { kickoffAt: 'asc' },
      });

      const items = await db.contentItem.findMany({
        where: {
          active: true,
          deletedAt: null,
          OR: [{ clubId: unit.jerseyModel.clubId }, { clubId: null }],
        },
        include: { rules: true },
      });

      const ctx: ContentContext = {
        clubId: unit.jerseyModel.clubId,
        seasonId: unit.jerseyModel.seasonId,
        jerseyModelId: unit.jerseyModelId,
        playerId: unit.playerId,
        shirtNumber: unit.shirtNumber ?? unit.player?.shirtNumber ?? null,
        trustLevel: (query.trustLevel as TrustLevel) ?? 'IDENTIFIED_ONLY',
        unitCondition: unit.condition as UnitCondition,
        matchPhase: (nextMatch?.phase as MatchPhase) ?? 'NONE',
        matchResult: resolveMatchResult(nextMatch),
        interactionCount: unit.interactionCount,
        loyaltyTier: fan?.loyaltyTier ?? 0,
        now: new Date(),
        // Sin consentimiento de ubicacion, el pais ni siquiera se pasa al motor.
        countryCode: locationConsent ? context.countryCode : null,
        locationConsent,
        lowDataMode: query.lowData === '1' || context.lowDataMode,
      };

      const domainItems: ContentItem[] = items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title as Record<string, string>,
        body: item.body as Record<string, string>,
        mediaUrl: item.mediaUrl,
        mediaAlt: item.mediaAlt as Record<string, string> | null,
        captionsUrl: item.captionsUrl,
        ctaLabel: item.ctaLabel as Record<string, string> | null,
        ctaHref: item.ctaHref,
        priority: item.priority,
        campaignId: item.campaignId,
        estimatedMediaBytes: item.estimatedMediaBytes,
        conditions: mergeRuleConditions(item.rules),
      }));

      const resolved = filterSponsoredContent(resolveContent(domainItems, ctx), sponsorConsent);

      return {
        language: context.language,
        lowDataMode: ctx.lowDataMode,
        items: resolved.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: pickLanguage(item.title, context.language),
          body: pickLanguage(item.body, context.language),
          mediaUrl: item.mediaUrl,
          mediaAlt: item.mediaAlt ? pickLanguage(item.mediaAlt, context.language) : null,
          captionsUrl: item.captionsUrl,
          ctaLabel: item.ctaLabel ? pickLanguage(item.ctaLabel, context.language) : null,
          ctaHref: item.ctaHref,
          mediaOmittedForLowData: item.mediaOmittedForLowData,
        })),
      };
    },
  );

  /** Catalogo de finalidades de consentimiento. Publico y transparente. */
  app.get(
    '/consents/catalog',
    { schema: { tags: ['publico'], summary: 'Catalogo de finalidades de consentimiento' } },
    async () => ({
      policyVersion: CURRENT_POLICY_VERSION,
      purposes: CONSENT_PURPOSES.map((purpose) => ({
        purpose,
        ...CONSENT_COPY[purpose],
      })),
      /** Funciones que nunca dependen de un consentimiento. */
      alwaysAvailable: [
        'Verificar la autenticidad de su jersey',
        'Consultar el certificado digital',
        'Abrir un caso de soporte o garantia',
      ],
    }),
  );

  /** Alta de un caso de soporte. No requiere cuenta. */
  app.post(
    '/support/cases',
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_PUBLIC_FORMS_PER_HOUR,
          timeWindow: '1 hour',
        },
      },
      schema: { tags: ['publico'], summary: 'Abre un caso de soporte o garantia' },
    },
    async (request, reply) => {
      const body = z
        .object({
          contactEmail: z.string().email().max(320),
          reason: z.enum([
            'AUTHENTICITY_DOUBT',
            'WARRANTY',
            'NFC_NOT_READING',
            'TRANSFER_ISSUE',
            'OTHER',
          ]),
          subject: z.string().min(3).max(200),
          description: z.string().min(10).max(4000),
          unitHandle: z.string().uuid().optional(),
        })
        .parse(request.body);

      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      // Se comprueba que la unidad exista, pero no se revela si existia o no:
      // en ambos casos el caso se crea y la respuesta es identica.
      const unit = body.unitHandle
        ? await db.jerseyUnit.findUnique({ where: { id: body.unitHandle }, select: { id: true } })
        : null;

      const created = await db.supportCase.create({
        data: {
          contactEmail: body.contactEmail,
          reason: body.reason,
          subject: body.subject,
          description: body.description,
          jerseyUnitId: unit?.id ?? null,
        },
        select: { id: true, createdAt: true },
      });

      await recordAudit(db, {
        actorType: 'ANONYMOUS',
        action: 'support.case.created',
        entityType: 'SupportCase',
        entityId: created.id,
        metadata: { reason: body.reason },
        ipPrefix: context.ipPrefix,
      });

      return reply.status(201).send({
        caseId: created.id,
        createdAt: created.createdAt.toISOString(),
        message: 'Recibimos su solicitud. Le responderemos al correo indicado.',
      });
    },
  );

  /** Solicitud de derechos LOPDP. No requiere cuenta. */
  app.post(
    '/privacy/requests',
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_PUBLIC_FORMS_PER_HOUR,
          timeWindow: '1 hour',
        },
      },
      schema: { tags: ['publico'], summary: 'Solicitud de derechos sobre datos personales' },
    },
    async (request, reply) => {
      const body = z
        .object({
          email: z.string().email().max(320),
          type: z.enum([
            'ACCESS',
            'RECTIFICATION',
            'DELETION',
            'OPPOSITION',
            'PORTABILITY',
            'CONSENT_WITHDRAWAL',
          ]),
          details: z.string().max(2000).optional(),
        })
        .parse(request.body);

      const fan = await db.fanAccount.findUnique({
        where: { email: body.email },
        select: { id: true },
      });

      const created = await db.privacyRequest.create({
        data: {
          email: body.email,
          type: body.type,
          details: body.details ?? null,
          fanId: fan?.id ?? null,
          dueAt: new Date(Date.now() + PRIVACY_REQUEST_SLA_DAYS * 86_400_000),
        },
        select: { id: true, dueAt: true },
      });

      return reply.status(201).send({
        requestId: created.id,
        dueAt: created.dueAt.toISOString(),
        // La respuesta no revela si existe una cuenta con ese correo.
        message:
          'Recibimos su solicitud. Si existe informacion asociada a ese correo, le responderemos ' +
          `dentro de ${PRIVACY_REQUEST_SLA_DAYS} dias. Podemos solicitarle verificar su identidad.`,
      });
    },
  );
}

export const CURRENT_POLICY_VERSION = '2026-01';

function pickLanguage(map: Record<string, string>, language: string): string {
  return map[language] ?? map.es ?? Object.values(map)[0] ?? '';
}

function resolveMatchResult(match: { goalsFor: number | null; goalsAgainst: number | null } | null): MatchResult {
  if (!match || match.goalsFor == null || match.goalsAgainst == null) return 'UNKNOWN';
  if (match.goalsFor > match.goalsAgainst) return 'WIN';
  if (match.goalsFor < match.goalsAgainst) return 'LOSS';
  return 'DRAW';
}

/**
 * Combina las condiciones de todas las reglas de un item.
 * Las reglas se almacenan como JSON y se validan aqui antes de usarse: un JSON
 * arbitrario de la base de datos nunca se pasa directamente al motor.
 */
const conditionsSchema = z
  .object({
    clubIds: z.array(z.string()).optional(),
    seasonIds: z.array(z.string()).optional(),
    jerseyModelIds: z.array(z.string()).optional(),
    playerIds: z.array(z.string()).optional(),
    shirtNumbers: z.array(z.number().int()).optional(),
    trustLevels: z.array(z.string()).optional(),
    unitConditions: z.array(z.string()).optional(),
    matchPhases: z.array(z.string()).optional(),
    matchResults: z.array(z.string()).optional(),
    minInteractions: z.number().int().optional(),
    maxInteractions: z.number().int().optional(),
    minLoyaltyTier: z.number().int().optional(),
    countryCodes: z.array(z.string()).optional(),
  })
  .passthrough();

function mergeRuleConditions(
  rules: { conditions: unknown; activeFrom: Date | null; activeUntil: Date | null }[],
): ContentItem['conditions'] {
  const merged: Record<string, unknown> = {};
  for (const rule of rules) {
    const parsed = conditionsSchema.safeParse(rule.conditions);
    if (!parsed.success) continue;
    Object.assign(merged, parsed.data);
    if (rule.activeFrom) merged.activeFrom = rule.activeFrom;
    if (rule.activeUntil) merged.activeUntil = rule.activeUntil;
  }
  return merged as ContentItem['conditions'];
}

export { contentItemMatches };
