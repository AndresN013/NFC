import { describe, expect, it } from 'vitest';
import {
  MIN_AGGREGATE_COHORT_SIZE,
  SPONSOR_AGGREGATE_METRICS,
  SPONSOR_VISIBLE_EVENTS,
  suppressSmallCohort,
  truncateIp,
  EVENT_DATA_CLASS,
  ANALYTICS_EVENTS,
} from './analytics.js';
import {
  PRIVACY_REQUEST_STATES,
  PRIVACY_REQUEST_STATE_COPY,
  PRIVACY_REQUEST_TYPES,
  PRIVACY_REQUEST_TYPE_COPY,
  CONSENT_PURPOSES,
  CONSENT_COPY,
  FEATURES_WITHOUT_CONSENT,
  hasActiveConsent,
  type ConsentRecord,
} from './privacy.js';

describe('seudonimizacion de IP', () => {
  it('descarta el ultimo octeto en IPv4', () => {
    expect(truncateIp('186.101.55.77')).toBe('186.101.55.0');
  });

  it('conserva solo 48 bits en IPv6', () => {
    expect(truncateIp('2803:a3e0:1234:5678:9abc:def0:1234:5678')).toBe('2803:a3e0:1234::');
  });

  it('degrada con seguridad ante una entrada malformada', () => {
    expect(truncateIp('no-es-una-ip')).toBe('0.0.0.0');
  });
});

describe('supresion de cohortes pequenas', () => {
  it('oculta agregados que identificarian a una persona', () => {
    expect(suppressSmallCohort(1)).toBeNull();
    expect(suppressSmallCohort(MIN_AGGREGATE_COHORT_SIZE - 1)).toBeNull();
  });

  it('muestra agregados suficientemente grandes', () => {
    expect(suppressSmallCohort(MIN_AGGREGATE_COHORT_SIZE)).toBe(MIN_AGGREGATE_COHORT_SIZE);
  });
});

describe('exposicion a patrocinadores', () => {
  it('ningun evento identificado es visible para patrocinadores', () => {
    for (const event of SPONSOR_VISIBLE_EVENTS) {
      expect(EVENT_DATA_CLASS[event]).not.toBe('IDENTIFIED');
    }
  });

  it('todo evento del catalogo tiene una clasificacion de dato', () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(EVENT_DATA_CLASS[event]).toBeDefined();
    }
  });

  it('los eventos de transferencia y soporte nunca se exponen', () => {
    expect(SPONSOR_VISIBLE_EVENTS).not.toContain('TRANSFER_COMPLETED');
    expect(SPONSOR_VISIBLE_EVENTS).not.toContain('SUPPORT_OPENED');
    expect(SPONSOR_VISIBLE_EVENTS).not.toContain('JERSEY_CLAIMED');
  });

  it('los canjes llegan al patrocinador como metrica materializada, no como evento', () => {
    expect(SPONSOR_VISIBLE_EVENTS).not.toContain('REWARD_REDEEMED');
    expect(SPONSOR_AGGREGATE_METRICS).toContain('campaign_reward_redemptions');
  });
});

describe('consentimientos', () => {
  const base = (overrides: Partial<ConsentRecord>): ConsentRecord => ({
    purpose: 'MARKETING',
    granted: true,
    grantedAt: new Date('2026-01-01T00:00:00Z'),
    revokedAt: null,
    policyVersion: '2026-01',
    ...overrides,
  });

  it('un consentimiento otorgado y no revocado esta activo', () => {
    expect(hasActiveConsent([base({})], 'MARKETING')).toBe(true);
  });

  it('un consentimiento revocado deja de estar activo', () => {
    expect(hasActiveConsent([base({ revokedAt: new Date() })], 'MARKETING')).toBe(false);
  });

  it('una finalidad sin registro no se presume otorgada', () => {
    expect(hasActiveConsent([base({})], 'LOCATION')).toBe(false);
  });

  it('toda finalidad tiene texto informativo en espanol', () => {
    for (const purpose of CONSENT_PURPOSES) {
      expect(CONSENT_COPY[purpose].titulo.length).toBeGreaterThan(0);
      expect(CONSENT_COPY[purpose].descripcion.length).toBeGreaterThan(20);
    }
  });

  it('verificar el jersey nunca depende de un consentimiento', () => {
    expect(FEATURES_WITHOUT_CONSENT).toContain('verificar_jersey');
    expect(FEATURES_WITHOUT_CONSENT).toContain('ver_certificado');
  });
});

describe('textos de las solicitudes de privacidad', () => {
  it('todo tipo declarado tiene texto en espanol', () => {
    for (const type of PRIVACY_REQUEST_TYPES) {
      expect(PRIVACY_REQUEST_TYPE_COPY[type], type).toBeTruthy();
      expect(PRIVACY_REQUEST_TYPE_COPY[type].length).toBeGreaterThan(5);
    }
  });

  it('todo estado declarado tiene texto en espanol', () => {
    for (const state of PRIVACY_REQUEST_STATES) {
      expect(PRIVACY_REQUEST_STATE_COPY[state], state).toBeTruthy();
    }
  });

  it('no hay textos para tipos que el dominio no emite', () => {
    // El panel declaraba `OBJECTION`, que no existe: el tipo real es `OPPOSITION`.
    const conTexto = Object.keys(PRIVACY_REQUEST_TYPE_COPY);
    expect(conTexto.sort()).toEqual([...PRIVACY_REQUEST_TYPES].sort());
  });
});
