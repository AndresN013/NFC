import { describe, expect, it } from 'vitest';
import { evaluateRisk, RISK_THRESHOLDS } from './engine.js';
import type { RiskEvaluationInput, VerificationHistory, UnitContext } from './types.js';

const NOW = new Date('2026-03-01T12:00:00Z');

function emptyHistory(overrides: Partial<VerificationHistory> = {}): VerificationHistory {
  return {
    lastAcceptedCounter: null,
    readsLastHour: 1,
    readsLast24h: 1,
    distinctDevices24h: 1,
    distinctIps24h: 1,
    lastLocation: null,
    lastLocationAt: null,
    messageAlreadySeen: false,
    ...overrides,
  };
}

function activatedUnit(overrides: Partial<UnitContext> = {}): UnitContext {
  return {
    chipType: 'NTAG424DNA',
    chipState: 'ACTIVATED',
    unitState: 'SOLD',
    activatedAt: new Date('2026-01-10T00:00:00Z'),
    activeOwnerCount: 1,
    batchFlagged: false,
    ...overrides,
  };
}

function input(overrides: Partial<RiskEvaluationInput> = {}): RiskEvaluationInput {
  return {
    method: 'NFC_CRYPTOGRAPHIC',
    unit: activatedUnit(),
    crypto: { signatureValid: true, readCounter: 10, simulated: false },
    history: emptyHistory(),
    currentLocation: { countryCode: 'EC' },
    now: NOW,
    ...overrides,
  };
}

describe('evaluateRisk - identificacion frente a autenticacion', () => {
  it('devuelve VERIFIED solo con firma real valida sobre chip capaz', () => {
    const r = evaluateRisk(input());
    expect(r.trustLevel).toBe('VERIFIED');
    expect(r.reasonCodes).toContain('CRYPTO_VERIFIED_OK');
    expect(r.riskLevel).toBe('NONE');
  });

  it('NUNCA devuelve VERIFIED si la evidencia proviene de un proveedor simulado', () => {
    const r = evaluateRisk(
      input({ crypto: { signatureValid: true, readCounter: 10, simulated: true } }),
    );
    expect(r.trustLevel).toBe('IDENTIFIED_ONLY');
  });

  it('una URL NDEF estatica nunca supera IDENTIFIED_ONLY', () => {
    const r = evaluateRisk(input({ method: 'NFC_STATIC_URL', crypto: null }));
    expect(r.trustLevel).toBe('IDENTIFIED_ONLY');
    expect(r.reasonCodes).toContain('METHOD_NOT_CRYPTOGRAPHIC');
  });

  it('un QR nunca supera IDENTIFIED_ONLY aunque se adjunte evidencia', () => {
    const r = evaluateRisk(
      input({
        method: 'QR_CODE',
        crypto: { signatureValid: true, readCounter: 99, simulated: false },
      }),
    );
    expect(r.trustLevel).toBe('IDENTIFIED_ONLY');
    expect(r.reasonCodes).toContain('QR_FALLBACK_USED');
  });

  it('marca que una NTAG213 no puede autenticar criptograficamente', () => {
    const r = evaluateRisk(
      input({
        method: 'NFC_STATIC_URL',
        crypto: null,
        unit: activatedUnit({ chipType: 'NTAG213' }),
      }),
    );
    expect(r.reasonCodes).toContain('CHIP_TYPE_NOT_CRYPTO_CAPABLE');
    expect(r.trustLevel).toBe('IDENTIFIED_ONLY');
  });
});

describe('evaluateRisk - estados terminales', () => {
  it('chip revocado devuelve REVOKED y bloquea recompensas', () => {
    const r = evaluateRisk(input({ unit: activatedUnit({ chipState: 'REVOKED' }) }));
    expect(r.trustLevel).toBe('REVOKED');
    expect(r.recommendedActions).toContain('BLOCK_REWARDS');
  });

  it('unidad revocada devuelve REVOKED aunque el chip siga activo', () => {
    const r = evaluateRisk(input({ unit: activatedUnit({ unitState: 'REVOKED' }) }));
    expect(r.trustLevel).toBe('REVOKED');
  });

  it('cuarentena devuelve SUSPICIOUS y exige revision humana', () => {
    const r = evaluateRisk(input({ unit: activatedUnit({ chipState: 'QUARANTINED' }) }));
    expect(r.trustLevel).toBe('SUSPICIOUS');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('lectura de un chip aun en produccion devuelve NOT_ACTIVATED', () => {
    const r = evaluateRisk(
      input({ unit: activatedUnit({ chipState: 'READY_FOR_HEAT_PRESS', activatedAt: null }) }),
    );
    expect(r.trustLevel).toBe('NOT_ACTIVATED');
    expect(r.reasonCodes).toContain('READ_BEFORE_PRODUCTION_COMPLETE');
  });

  it('token desconocido devuelve UNVERIFIABLE sin filtrar informacion', () => {
    const r = evaluateRisk(input({ unit: null }));
    expect(r.trustLevel).toBe('UNVERIFIABLE');
    expect(r.userMessage.explicacion).not.toContain('token');
  });

  it('payload ilegible devuelve UNVERIFIABLE y sugiere reintentar', () => {
    const r = evaluateRisk(input({ payloadUnreadable: true }));
    expect(r.trustLevel).toBe('UNVERIFIABLE');
    expect(r.recommendedActions).toContain('SUGGEST_RETRY_NFC');
  });
});

describe('evaluateRisk - anti-replay', () => {
  it('detecta contador que no avanza', () => {
    const r = evaluateRisk(
      input({
        crypto: { signatureValid: true, readCounter: 10, simulated: false },
        history: emptyHistory({ lastAcceptedCounter: 10 }),
      }),
    );
    expect(r.reasonCodes).toContain('COUNTER_NOT_INCREASING');
    expect(r.trustLevel).toBe('SUSPICIOUS');
    expect(r.requiresHumanReview).toBe(true);
  });

  it('detecta reutilizacion del mismo mensaje autenticado', () => {
    const r = evaluateRisk(
      input({ history: emptyHistory({ messageAlreadySeen: true, lastAcceptedCounter: 5 }) }),
    );
    expect(r.reasonCodes).toContain('MESSAGE_ALREADY_SEEN');
    expect(r.trustLevel).toBe('SUSPICIOUS');
  });

  it('un salto grande de contador es senal blanda, no veredicto', () => {
    const r = evaluateRisk(
      input({
        crypto: { signatureValid: true, readCounter: 5000, simulated: false },
        history: emptyHistory({ lastAcceptedCounter: 10 }),
      }),
    );
    expect(r.reasonCodes).toContain('COUNTER_LARGE_GAP');
    expect(r.trustLevel).toBe('VERIFIED');
  });

  it('firma invalida degrada a SUSPICIOUS y abre alerta', () => {
    const r = evaluateRisk(
      input({ crypto: { signatureValid: false, readCounter: 11, simulated: false } }),
    );
    expect(r.trustLevel).toBe('SUSPICIOUS');
    expect(r.recommendedActions).toContain('OPEN_RISK_ALERT');
  });
});

describe('evaluateRisk - las senales blandas no condenan por si solas', () => {
  it('una anomalia geografica aislada NO declara sospechoso el jersey', () => {
    const r = evaluateRisk(
      input({
        currentLocation: { countryCode: 'CN' },
        history: emptyHistory({
          lastLocation: { countryCode: 'EC' },
          lastLocationAt: new Date('2026-03-01T11:00:00Z'),
        }),
      }),
    );
    expect(r.reasonCodes).toContain('IMPOSSIBLE_TRAVEL');
    expect(r.reasonCodes).toContain('UNEXPECTED_COUNTRY');
    expect(r.trustLevel).toBe('VERIFIED');
    expect(r.riskScore).toBeLessThan(RISK_THRESHOLDS.SUSPICIOUS);
  });

  it('alta frecuencia por si sola no degrada el nivel', () => {
    const r = evaluateRisk(input({ history: emptyHistory({ readsLastHour: 90 }) }));
    expect(r.reasonCodes).toContain('HIGH_READ_FREQUENCY');
    expect(r.trustLevel).toBe('VERIFIED');
  });

  it('muchos dispositivos por si solos no degradan el nivel', () => {
    const r = evaluateRisk(input({ history: emptyHistory({ distinctDevices24h: 40 }) }));
    expect(r.reasonCodes).toContain('MANY_DISTINCT_DEVICES');
    expect(r.trustLevel).toBe('VERIFIED');
  });

  it('la acumulacion de varias senales blandas si degrada a SUSPICIOUS', () => {
    const r = evaluateRisk(
      input({
        currentLocation: { countryCode: 'CN' },
        history: emptyHistory({
          readsLastHour: 90,
          distinctDevices24h: 40,
          distinctIps24h: 60,
          lastLocation: { countryCode: 'EC' },
          lastLocationAt: new Date('2026-03-01T11:00:00Z'),
        }),
      }),
    );
    expect(r.riskScore).toBeGreaterThanOrEqual(RISK_THRESHOLDS.SUSPICIOUS);
    expect(r.trustLevel).toBe('SUSPICIOUS');
  });

  it('multiples titularidades activas exigen revision humana', () => {
    const r = evaluateRisk(input({ unit: activatedUnit({ activeOwnerCount: 3 }) }));
    expect(r.reasonCodes).toContain('MULTIPLE_ACTIVE_OWNERS');
    expect(r.requiresHumanReview).toBe(true);
  });
});

describe('evaluateRisk - mensaje al usuario', () => {
  it('no expone codigos de razon internos en el mensaje visible', () => {
    const r = evaluateRisk(
      input({ crypto: { signatureValid: false, readCounter: 11, simulated: false } }),
    );
    const visible = `${r.userMessage.titulo} ${r.userMessage.explicacion}`;
    for (const code of r.reasonCodes) {
      expect(visible).not.toContain(code);
    }
  });

  it('el mensaje de sospecha no acusa al aficionado de tener un producto falso', () => {
    const r = evaluateRisk(input({ unit: activatedUnit({ chipState: 'QUARANTINED' }) }));
    expect(r.userMessage.explicacion).toContain('no significa que su jersey sea falso');
  });

  it('ofrece reclamar la prenda cuando no tiene propietario', () => {
    const r = evaluateRisk(input({ unit: activatedUnit({ activeOwnerCount: 0 }) }));
    expect(r.recommendedActions).toContain('OFFER_CLAIM');
  });
});
