import type { UnitCondition } from './states.js';
import type { TrustLevel } from './trust.js';

/**
 * Motor de contenido dinamico.
 *
 * Una regla declara CONDICIONES; el motor selecciona los items cuyas condiciones
 * se cumplen y los ordena por prioridad. Las condiciones ausentes se ignoran
 * (una regla sin condiciones aplica siempre).
 *
 * PRIVACIDAD: la condicion de ubicacion solo se evalua si el contexto trae
 * `locationConsent: true`. Sin consentimiento, las reglas con condicion
 * geografica simplemente no aplican; nunca se evaluan "por si acaso".
 */

export const MATCH_PHASES = ['UPCOMING', 'LIVE', 'FINISHED', 'NONE'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export const MATCH_RESULTS = ['WIN', 'DRAW', 'LOSS', 'UNKNOWN'] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export const CONTENT_KINDS = [
  'HERO',
  'STORY',
  'VIDEO',
  'QUIZ',
  'POLL',
  'REWARD_TEASER',
  'SPONSOR_MESSAGE',
  'MATCH_CARD',
  'CARE_INSTRUCTIONS',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export interface ContentConditions {
  clubIds?: string[];
  seasonIds?: string[];
  jerseyModelIds?: string[];
  playerIds?: string[];
  /** Dorsales concretos, por ejemplo una camiseta con el 10. */
  shirtNumbers?: number[];
  trustLevels?: TrustLevel[];
  unitConditions?: UnitCondition[];
  matchPhases?: MatchPhase[];
  matchResults?: MatchResult[];
  /** Rango de interacciones acumuladas de la unidad. */
  minInteractions?: number;
  maxInteractions?: number;
  /** Nivel de fidelidad minimo del aficionado (0 si es anonimo). */
  minLoyaltyTier?: number;
  /** Ventana de vigencia. */
  activeFrom?: Date | null;
  activeUntil?: Date | null;
  /** Codigos de pais. REQUIERE consentimiento de ubicacion. */
  countryCodes?: string[];
}

export interface ContentItem {
  id: string;
  kind: ContentKind;
  /** Clave de traduccion o texto por idioma. */
  title: Record<string, string>;
  body: Record<string, string>;
  mediaUrl?: string | null;
  /** Texto alternativo obligatorio cuando hay imagen: accesibilidad. */
  mediaAlt?: Record<string, string> | null;
  /** Subtitulos para video. */
  captionsUrl?: string | null;
  ctaLabel?: Record<string, string> | null;
  ctaHref?: string | null;
  priority: number;
  conditions: ContentConditions;
  /** Campana a la que pertenece, si es contenido patrocinado. */
  campaignId?: string | null;
  /** Peso en bytes estimado del medio, para el modo de bajo consumo de datos. */
  estimatedMediaBytes?: number | null;
}

export interface ContentContext {
  clubId: string;
  seasonId: string;
  jerseyModelId: string;
  playerId: string | null;
  shirtNumber: number | null;
  trustLevel: TrustLevel;
  unitCondition: UnitCondition;
  matchPhase: MatchPhase;
  matchResult: MatchResult;
  interactionCount: number;
  loyaltyTier: number;
  now: Date;
  /** Solo presente si `locationConsent` es true. */
  countryCode: string | null;
  locationConsent: boolean;
  /** El usuario pidio ahorrar datos: se excluye el medio pesado. */
  lowDataMode: boolean;
}

function matchesList<T>(allowed: T[] | undefined, actual: T | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (actual == null) return false;
  return allowed.includes(actual);
}

/** Umbral por encima del cual un medio se omite en modo de bajo consumo. */
export const LOW_DATA_MEDIA_BYTES_LIMIT = 150_000;

export function contentItemMatches(item: ContentItem, ctx: ContentContext): boolean {
  const c = item.conditions;

  if (c.activeFrom && ctx.now < c.activeFrom) return false;
  if (c.activeUntil && ctx.now > c.activeUntil) return false;

  if (!matchesList(c.clubIds, ctx.clubId)) return false;
  if (!matchesList(c.seasonIds, ctx.seasonId)) return false;
  if (!matchesList(c.jerseyModelIds, ctx.jerseyModelId)) return false;
  if (!matchesList(c.playerIds, ctx.playerId)) return false;
  if (!matchesList(c.shirtNumbers, ctx.shirtNumber)) return false;
  if (!matchesList(c.trustLevels, ctx.trustLevel)) return false;
  if (!matchesList(c.unitConditions, ctx.unitCondition)) return false;
  if (!matchesList(c.matchPhases, ctx.matchPhase)) return false;
  if (!matchesList(c.matchResults, ctx.matchResult)) return false;

  if (c.minInteractions != null && ctx.interactionCount < c.minInteractions) return false;
  if (c.maxInteractions != null && ctx.interactionCount > c.maxInteractions) return false;
  if (c.minLoyaltyTier != null && ctx.loyaltyTier < c.minLoyaltyTier) return false;

  // Condicion geografica: sin consentimiento, la regla NO aplica.
  if (c.countryCodes && c.countryCodes.length > 0) {
    if (!ctx.locationConsent || !ctx.countryCode) return false;
    if (!c.countryCodes.includes(ctx.countryCode)) return false;
  }

  return true;
}

export interface ResolvedContentItem extends ContentItem {
  /** true si el medio se omitio por el modo de bajo consumo de datos. */
  mediaOmittedForLowData: boolean;
}

/**
 * Resuelve el contenido aplicable, ordenado por prioridad descendente.
 * `maxItems` limita el payload: la web del aficionado debe cargar rapido en 3G.
 */
export function resolveContent(
  items: readonly ContentItem[],
  ctx: ContentContext,
  maxItems = 12,
): ResolvedContentItem[] {
  return items
    .filter((item) => contentItemMatches(item, ctx))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, maxItems)
    .map((item) => {
      const heavy =
        ctx.lowDataMode &&
        item.mediaUrl != null &&
        (item.estimatedMediaBytes ?? 0) > LOW_DATA_MEDIA_BYTES_LIMIT;
      return {
        ...item,
        mediaUrl: heavy ? null : item.mediaUrl,
        mediaOmittedForLowData: heavy,
      };
    });
}

/**
 * Contenido patrocinado: solo se entrega si hay consentimiento de analitica de
 * patrocinadores O si el item no rastrea al usuario. En el MVP se aplica la
 * regla conservadora: sin consentimiento, no se muestra SPONSOR_MESSAGE.
 */
export function filterSponsoredContent(
  items: readonly ResolvedContentItem[],
  sponsorConsent: boolean,
): ResolvedContentItem[] {
  if (sponsorConsent) return [...items];
  return items.filter((item) => item.kind !== 'SPONSOR_MESSAGE');
}
