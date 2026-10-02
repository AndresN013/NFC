import { describe, expect, it } from 'vitest';
import { approximateCountryDistanceKm, detectImpossibleTravel, haversineKm } from './geo.js';

describe('distancias aproximadas', () => {
  it('calcula la distancia de gran circulo', () => {
    // Quito -> Guayaquil, ~270 km
    const d = haversineKm({ lat: -0.18, lon: -78.47 }, { lat: -2.17, lon: -79.92 });
    expect(d).toBeGreaterThan(240);
    expect(d).toBeLessThan(300);
  });

  it('no inventa distancias para paises fuera del catalogo', () => {
    expect(approximateCountryDistanceKm('EC', 'ZZ')).toBeNull();
  });
});

describe('deteccion de viaje imposible', () => {
  it('detecta un salto intercontinental en una hora', () => {
    const r = detectImpossibleTravel({
      previousCountry: 'EC',
      previousAt: new Date('2026-03-01T11:00:00Z'),
      currentCountry: 'CN',
      currentAt: new Date('2026-03-01T12:00:00Z'),
    });
    expect(r.impossible).toBe(true);
  });

  it('NO marca como imposible un vuelo real de Quito a Madrid', () => {
    const r = detectImpossibleTravel({
      previousCountry: 'EC',
      previousAt: new Date('2026-03-01T00:00:00Z'),
      currentCountry: 'ES',
      currentAt: new Date('2026-03-01T12:00:00Z'),
    });
    expect(r.impossible).toBe(false);
  });

  it('no emite juicio dentro del error del centroide', () => {
    const r = detectImpossibleTravel({
      previousCountry: 'EC',
      previousAt: new Date('2026-03-01T11:55:00Z'),
      currentCountry: 'CO',
      currentAt: new Date('2026-03-01T12:00:00Z'),
    });
    expect(r.impossible).toBe(false);
  });

  it('no emite juicio si algun pais es desconocido', () => {
    const r = detectImpossibleTravel({
      previousCountry: 'XX',
      previousAt: new Date('2026-03-01T11:00:00Z'),
      currentCountry: 'EC',
      currentAt: new Date('2026-03-01T12:00:00Z'),
    });
    expect(r.impossible).toBe(false);
    expect(r.distanceKm).toBeNull();
  });

  it('tolera relojes desordenados sin dividir por cero', () => {
    const r = detectImpossibleTravel({
      previousCountry: 'EC',
      previousAt: new Date('2026-03-01T12:00:00Z'),
      currentCountry: 'CN',
      currentAt: new Date('2026-03-01T11:00:00Z'),
    });
    expect(Number.isFinite(r.impliedSpeedKmh ?? 0)).toBe(true);
  });
});
