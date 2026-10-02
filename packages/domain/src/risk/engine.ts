import { detectImpossibleTravel, PILOT_ADJACENT_COUNTRIES, PILOT_EXPECTED_COUNTRIES } from '../geo.js';
import { PRE_RETAIL_CHIP_STATES } from '../states.js';
import {
  applyMethodCeiling,
  supportsCryptographicAuthentication,
  TRUST_LEVEL_COPY,
  worstTrustLevel,
} from '../trust.js';
import type { RiskLevel, TrustLevel } from '../trust.js';
import type {
  ReasonCode,
  RecommendedAction,
  RiskAssessment,
  RiskEvaluationInput,
  RiskFinding,
} from './types.js';

/**
 * Umbrales de puntuacion de riesgo.
 *
 * Los pesos se calibraron para que NINGUNA senal blanda aislada (geografia,
 * frecuencia, numero de dispositivos) alcance por si sola el umbral de
 * SUSPICIOUS. Hacen falta al menos dos senales blandas, o una senal dura
 * (firma invalida, replay de contador).
 */
export const RISK_THRESHOLDS = {
  LOW: 20,
  MEDIUM: 40,
  /** A partir de aqui el nivel de confianza se degrada a SUSPICIOUS. */
  SUSPICIOUS: 60,
} as const;

/** Umbrales de patrones de uso. Configurables por despliegue. */
export interface RiskEngineConfig {
  readsPerHourThreshold: number;
  readsPer24hThreshold: number;
  distinctDevices24hThreshold: number;
  distinctIps24hThreshold: number;
  /** Salto maximo tolerado del contador de lecturas del chip. */
  counterGapThreshold: number;
}

export const DEFAULT_RISK_CONFIG: RiskEngineConfig = {
  readsPerHourThreshold: 25,
  readsPer24hThreshold: 120,
  distinctDevices24hThreshold: 8,
  distinctIps24hThreshold: 15,
  counterGapThreshold: 200,
};

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.SUSPICIOUS) return 'HIGH';
  if (score >= RISK_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (score >= RISK_THRESHOLDS.LOW) return 'LOW';
  return 'NONE';
}

/**
 * Motor de reglas de autenticacion y riesgo.
 *
 * Contrato de diseno:
 *  1. Los estados terminales (revocado, no activado) cortan la evaluacion: son
 *     hechos administrativos, no inferencias.
 *  2. El nivel de confianza NUNCA supera el techo del metodo de lectura.
 *  3. Una evidencia criptografica SIMULADA jamas produce VERIFIED.
 *  4. Una anomalia geografica aislada NO declara sospechoso un jersey.
 *  5. El mensaje al usuario se deriva del nivel de confianza, nunca del codigo
 *     de razon interno.
 */
export function evaluateRisk(
  input: RiskEvaluationInput,
  config: RiskEngineConfig = DEFAULT_RISK_CONFIG,
): RiskAssessment {
  const findings: RiskFinding[] = [];
  const actions = new Set<RecommendedAction>();

  const add = (code: ReasonCode, weight: number, detail: string): void => {
    findings.push({ code, weight, detail });
  };

  // --- 1. Legibilidad --------------------------------------------------------
  if (input.payloadUnreadable) {
    add('PAYLOAD_UNREADABLE', 0, 'El payload presentado esta incompleto o malformado.');
    actions.add('SUGGEST_RETRY_NFC');
    actions.add('SUGGEST_QR_FALLBACK');
    return finish('UNVERIFIABLE', findings, actions, false);
  }

  if (!input.unit) {
    // Token desconocido. Peso bajo porque la causa mas comun es un error de
    // tipeo o una URL truncada, no un ataque. La proteccion real contra
    // enumeracion es el rate limiting, no este puntaje.
    add('TOKEN_UNKNOWN', 10, 'El identificador presentado no corresponde a ninguna unidad.');
    actions.add('SUGGEST_RETRY_NFC');
    actions.add('CONTACT_SUPPORT');
    return finish('UNVERIFIABLE', findings, actions, false);
  }

  const unit = input.unit;

  // --- 2. Estados terminales -------------------------------------------------
  if (unit.chipState === 'REVOKED' || unit.chipState === 'DESTROYED') {
    add('CHIP_REVOKED', 100, `El chip se encuentra en estado ${unit.chipState}.`);
    actions.add('CONTACT_SUPPORT');
    actions.add('BLOCK_REWARDS');
    return finish('REVOKED', findings, actions, true);
  }

  if (unit.unitState === 'REVOKED') {
    add('UNIT_REVOKED', 100, 'La unidad de jersey fue revocada administrativamente.');
    actions.add('CONTACT_SUPPORT');
    actions.add('BLOCK_REWARDS');
    return finish('REVOKED', findings, actions, true);
  }

  if (unit.chipState === 'QUARANTINED' || unit.unitState === 'QUARANTINED') {
    add('CHIP_IN_QUARANTINE', 60, 'La unidad esta en cuarentena a la espera de revision humana.');
    actions.add('CONTACT_SUPPORT');
    actions.add('BLOCK_REWARDS');
    actions.add('REQUIRE_HUMAN_REVIEW');
    return finish('SUSPICIOUS', findings, actions, true);
  }

  // Lectura de un chip que aun no salio de la linea de produccion. Es normal
  // durante el control de calidad interno; es anomalo si viene de la web publica.
  if (PRE_RETAIL_CHIP_STATES.includes(unit.chipState)) {
    add(
      'READ_BEFORE_PRODUCTION_COMPLETE',
      15,
      `Lectura publica con el chip en estado de produccion ${unit.chipState}.`,
    );
    add('UNIT_NOT_ACTIVATED', 0, 'La unidad todavia no fue activada comercialmente.');
    actions.add('CONTACT_SUPPORT');
    return finish('NOT_ACTIVATED', findings, actions, false);
  }

  if (unit.chipState !== 'ACTIVATED' || unit.activatedAt == null) {
    add('UNIT_NOT_ACTIVATED', 0, 'La unidad todavia no fue activada comercialmente.');
    actions.add('CONTACT_SUPPORT');
    return finish('NOT_ACTIVATED', findings, actions, false);
  }

  // --- 3. Nivel base segun metodo y criptografia -----------------------------
  let level: TrustLevel = 'IDENTIFIED_ONLY';

  if (input.method === 'QR_CODE') {
    add('QR_FALLBACK_USED', 0, 'Identificacion por codigo visible. No otorga autenticacion.');
  } else if (input.method === 'NFC_STATIC_URL') {
    add(
      'METHOD_NOT_CRYPTOGRAPHIC',
      0,
      'Registro NDEF con URL estatica: identifica el producto, no lo autentica.',
    );
  }

  if (!supportsCryptographicAuthentication(unit.chipType)) {
    add(
      'CHIP_TYPE_NOT_CRYPTO_CAPABLE',
      0,
      `El chip ${unit.chipType} no puede producir una prueba criptografica verificable.`,
    );
  }

  if (input.method === 'NFC_CRYPTOGRAPHIC') {
    const crypto = input.crypto;
    if (!crypto) {
      add('CRYPTO_NOT_ATTEMPTED', 20, 'Se declaro metodo criptografico sin adjuntar evidencia.');
    } else if (crypto.simulated) {
      // Regla dura: una simulacion no es una prueba. Se degrada a identificacion.
      add(
        'CRYPTO_NOT_ATTEMPTED',
        0,
        'Evidencia producida por un proveedor SIMULADO. No constituye autenticacion real.',
      );
    } else if (!crypto.signatureValid) {
      add('CRYPTO_SIGNATURE_INVALID', 70, 'La firma presentada por el chip no es valida.');
      actions.add('OPEN_RISK_ALERT');
      actions.add('REQUIRE_HUMAN_REVIEW');
    } else {
      add('CRYPTO_VERIFIED_OK', 0, 'Firma del chip validada por el verificador de servidor.');
      level = 'VERIFIED';

      // Anti-replay: solo tiene sentido sobre una firma valida.
      if (input.history.messageAlreadySeen) {
        add(
          'MESSAGE_ALREADY_SEEN',
          80,
          'El mismo mensaje autenticado ya fue presentado antes (replay).',
        );
        actions.add('OPEN_RISK_ALERT');
        actions.add('REQUIRE_HUMAN_REVIEW');
      }

      const counter = crypto.readCounter;
      const lastCounter = input.history.lastAcceptedCounter;
      if (counter != null && lastCounter != null) {
        if (counter <= lastCounter) {
          add(
            'COUNTER_NOT_INCREASING',
            80,
            `Contador ${counter} no supera al ultimo aceptado ${lastCounter}.`,
          );
          actions.add('OPEN_RISK_ALERT');
          actions.add('REQUIRE_HUMAN_REVIEW');
        } else if (counter - lastCounter > config.counterGapThreshold) {
          // Salto grande: puede indicar lecturas en un dispositivo no reportado
          // o un contador manipulado. Senal blanda.
          add(
            'COUNTER_LARGE_GAP',
            25,
            `Salto del contador de ${counter - lastCounter} lecturas sin registrar.`,
          );
        }
      }
    }
  }

  // Techo del metodo. Aqui se garantiza que un QR nunca sea VERIFIED.
  level = applyMethodCeiling(level, input.method);

  // --- 4. Senales blandas de patron de uso -----------------------------------
  const h = input.history;

  if (h.readsLastHour > config.readsPerHourThreshold) {
    add(
      'HIGH_READ_FREQUENCY',
      25,
      `${h.readsLastHour} lecturas en la ultima hora (umbral ${config.readsPerHourThreshold}).`,
    );
  } else if (h.readsLast24h > config.readsPer24hThreshold) {
    add(
      'HIGH_READ_FREQUENCY',
      15,
      `${h.readsLast24h} lecturas en 24 horas (umbral ${config.readsPer24hThreshold}).`,
    );
  }

  if (h.distinctDevices24h > config.distinctDevices24hThreshold) {
    // Muchos dispositivos distintos es esperable en un estadio o una tienda.
    // Por eso el peso es moderado y no alcanza el umbral por si solo.
    add(
      'MANY_DISTINCT_DEVICES',
      25,
      `${h.distinctDevices24h} dispositivos distintos en 24 horas.`,
    );
  }

  if (h.distinctIps24h > config.distinctIps24hThreshold) {
    add('MANY_DISTINCT_IPS', 15, `${h.distinctIps24h} redes distintas en 24 horas.`);
  }

  // --- 5. Geografia ----------------------------------------------------------
  // Estas reglas tienen peso deliberadamente bajo. Una VPN, el roaming o un
  // proxy corporativo producen exactamente el mismo patron que un clon remoto.
  if (input.currentLocation) {
    const country = input.currentLocation.countryCode.toUpperCase();
    if (
      !PILOT_EXPECTED_COUNTRIES.includes(country) &&
      !PILOT_ADJACENT_COUNTRIES.includes(country)
    ) {
      add('UNEXPECTED_COUNTRY', 10, `Lectura desde ${country}, fuera del ambito del piloto.`);
    }

    if (h.lastLocation && h.lastLocationAt) {
      const travel = detectImpossibleTravel({
        previousCountry: h.lastLocation.countryCode,
        previousAt: h.lastLocationAt,
        currentCountry: country,
        currentAt: input.now,
      });
      if (travel.impossible) {
        add(
          'IMPOSSIBLE_TRAVEL',
          30,
          `Desplazamiento de ~${Math.round(travel.distanceKm ?? 0)} km en ${travel.elapsedHours.toFixed(1)} h. ` +
            'Puede deberse a VPN o roaming; no es prueba de falsificacion.',
        );
      }
    }
  }

  // --- 6. Propiedad y lote ---------------------------------------------------
  if (unit.activeOwnerCount > 1) {
    add(
      'MULTIPLE_ACTIVE_OWNERS',
      40,
      `${unit.activeOwnerCount} titularidades activas simultaneas sobre la misma unidad.`,
    );
    actions.add('REQUIRE_HUMAN_REVIEW');
  }

  if (unit.batchFlagged) {
    add('BATCH_ANOMALY_FLAGGED', 20, 'El lote de origen esta marcado con anomalias.');
  }

  // --- 7. Consolidacion ------------------------------------------------------
  const score = findings.reduce((sum, f) => sum + f.weight, 0);

  if (score >= RISK_THRESHOLDS.SUSPICIOUS) {
    level = worstTrustLevel(level, 'SUSPICIOUS');
    actions.add('OPEN_RISK_ALERT');
    actions.add('CONTACT_SUPPORT');
    actions.add('BLOCK_REWARDS');
  }

  if (level === 'VERIFIED' || level === 'IDENTIFIED_ONLY') {
    actions.add('SHOW_CERTIFICATE');
    if (unit.activeOwnerCount === 0) actions.add('OFFER_CLAIM');
  }
  if (level === 'IDENTIFIED_ONLY' && input.method === 'QR_CODE') {
    actions.add('SUGGEST_RETRY_NFC');
  }

  const requiresHumanReview =
    actions.has('REQUIRE_HUMAN_REVIEW') || score >= RISK_THRESHOLDS.SUSPICIOUS;

  return finish(level, findings, actions, requiresHumanReview);
}

function finish(
  level: TrustLevel,
  findings: RiskFinding[],
  actions: Set<RecommendedAction>,
  requiresHumanReview: boolean,
): RiskAssessment {
  const riskScore = findings.reduce((sum, f) => sum + f.weight, 0);
  if (actions.size === 0) actions.add('NONE');

  const copy = TRUST_LEVEL_COPY[level];

  return {
    trustLevel: level,
    riskLevel: scoreToRiskLevel(riskScore),
    riskScore,
    reasonCodes: findings.map((f) => f.code),
    findings,
    userMessage: { titulo: copy.titulo, explicacion: copy.explicacion, tono: copy.tono },
    recommendedActions: [...actions],
    requiresHumanReview,
  };
}

/**
 * Decide si un resultado debe generar una alerta de riesgo persistida.
 * Se evita crear ruido: solo se alerta cuando hay accion humana posible.
 */
export function shouldOpenRiskAlert(assessment: RiskAssessment): boolean {
  return (
    assessment.recommendedActions.includes('OPEN_RISK_ALERT') || assessment.requiresHumanReview
  );
}
