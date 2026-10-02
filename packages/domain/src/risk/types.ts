import type { ChipState, JerseyUnitState } from '../states.js';
import type { ApproximateLocation } from '../geo.js';
import type { ChipType, RiskLevel, TrustLevel, VerificationMethod } from '../trust.js';

/**
 * Codigos de razon INTERNOS. Nunca se muestran al aficionado tal cual: el
 * mensaje visible se deriva del nivel de confianza, no de la razon, para no
 * entregarle a un falsificador un canal de diagnostico sobre que control fallo.
 */
export const REASON_CODES = [
  // Estado del registro
  'CHIP_REVOKED',
  'UNIT_REVOKED',
  'UNIT_NOT_ACTIVATED',
  'CHIP_IN_QUARANTINE',
  'READ_BEFORE_PRODUCTION_COMPLETE',

  // Legibilidad
  'TOKEN_UNKNOWN',
  'PAYLOAD_UNREADABLE',

  // Criptografia
  'CRYPTO_VERIFIED_OK',
  'CRYPTO_SIGNATURE_INVALID',
  'CRYPTO_NOT_ATTEMPTED',
  'CHIP_TYPE_NOT_CRYPTO_CAPABLE',
  'METHOD_NOT_CRYPTOGRAPHIC',
  'QR_FALLBACK_USED',

  // Anti-replay
  'COUNTER_NOT_INCREASING',
  'COUNTER_LARGE_GAP',
  'MESSAGE_ALREADY_SEEN',

  // Patrones de uso
  'HIGH_READ_FREQUENCY',
  'MANY_DISTINCT_DEVICES',
  'MANY_DISTINCT_IPS',

  // Geografia
  'IMPOSSIBLE_TRAVEL',
  'UNEXPECTED_COUNTRY',

  // Propiedad y lote
  'MULTIPLE_ACTIVE_OWNERS',
  'BATCH_ANOMALY_FLAGGED',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** Acciones recomendadas al sistema y/o al aficionado. */
export const RECOMMENDED_ACTIONS = [
  'NONE',
  'SHOW_CERTIFICATE',
  'OFFER_CLAIM',
  'SUGGEST_RETRY_NFC',
  'SUGGEST_QR_FALLBACK',
  'CONTACT_SUPPORT',
  'OPEN_RISK_ALERT',
  'BLOCK_REWARDS',
  'REQUIRE_HUMAN_REVIEW',
] as const;

export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

/**
 * Resultado de la comprobacion criptografica, tal como lo reporta el verificador
 * del proveedor NFC correspondiente.
 */
export interface CryptographicEvidence {
  /** true solo si un verificador REAL valido la firma del chip. */
  signatureValid: boolean;
  /** Contador de lectura reportado por el chip, si el formato lo incluye. */
  readCounter: number | null;
  /**
   * Marca que el resultado proviene de un proveedor SIMULADO.
   * Si es true el motor NUNCA devuelve VERIFIED: una simulacion no es una prueba.
   */
  simulated: boolean;
}

/** Historial agregado previo de la unidad, calculado por la capa de datos. */
export interface VerificationHistory {
  /** Ultimo contador de lectura aceptado y persistido. */
  lastAcceptedCounter: number | null;
  /** Numero de lecturas en la ultima hora. */
  readsLastHour: number;
  /** Numero de lecturas en las ultimas 24 horas. */
  readsLast24h: number;
  /** Dispositivos distintos (huella seudonimizada) en 24 horas. */
  distinctDevices24h: number;
  /** IPs distintas (seudonimizadas) en 24 horas. */
  distinctIps24h: number;
  /** Ultima ubicacion aproximada observada y su momento. */
  lastLocation: ApproximateLocation | null;
  lastLocationAt: Date | null;
  /** true si ya se registro este mismo mensaje autenticado (replay). */
  messageAlreadySeen: boolean;
}

export interface UnitContext {
  chipType: ChipType;
  chipState: ChipState;
  unitState: JerseyUnitState;
  activatedAt: Date | null;
  /** Numero de propietarios con titularidad activa. Deberia ser 0 o 1. */
  activeOwnerCount: number;
  /** El lote fue marcado con anomalias por control de calidad o por riesgo. */
  batchFlagged: boolean;
}

export interface RiskEvaluationInput {
  method: VerificationMethod;
  /** null cuando el token presentado no corresponde a ninguna unidad conocida. */
  unit: UnitContext | null;
  crypto: CryptographicEvidence | null;
  history: VerificationHistory;
  currentLocation: ApproximateLocation | null;
  now: Date;
  /** El payload llego incompleto o malformado. */
  payloadUnreadable?: boolean;
}

export interface RiskFinding {
  code: ReasonCode;
  /** Puntos de riesgo. 0 para hallazgos puramente informativos. */
  weight: number;
  /** Detalle tecnico para el panel. No se muestra al aficionado. */
  detail: string;
}

export interface RiskAssessment {
  trustLevel: TrustLevel;
  riskLevel: RiskLevel;
  riskScore: number;
  /** Codigos internos, para el panel y la auditoria. */
  reasonCodes: ReasonCode[];
  findings: RiskFinding[];
  /** Mensaje seguro, ya redactado para el aficionado. */
  userMessage: { titulo: string; explicacion: string; tono: string };
  recommendedActions: RecommendedAction[];
  requiresHumanReview: boolean;
}
