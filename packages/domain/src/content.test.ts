import { describe, expect, it } from 'vitest';
import {
  contentItemMatches,
  filterSponsoredContent,
  resolveContent,
  type ContentContext,
  type ContentItem,
} from './content.js';

const NOW = new Date('2026-03-01T12:00:00Z');

function ctx(overrides: Partial<ContentContext> = {}): ContentContext {
  return {
    clubId: 'club-1',
    seasonId: 'season-2026',
    jerseyModelId: 'model-home',
    playerId: 'player-10',
    shirtNumber: 10,
    trustLevel: 'VERIFIED',
    unitCondition: 'NEW',
    matchPhase: 'UPCOMING',
    matchResult: 'UNKNOWN',
    interactionCount: 3,
    loyaltyTier: 1,
    now: NOW,
    countryCode: 'EC',
    locationConsent: false,
    lowDataMode: false,
    ...overrides,
  };
}

function item(id: string, overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id,
    kind: 'STORY',
    title: { es: id },
    body: { es: `cuerpo ${id}` },
    priority: 0,
    conditions: {},
    ...overrides,
  };
}

describe('coincidencia de reglas de contenido', () => {
  it('una regla sin condiciones aplica siempre', () => {
    expect(contentItemMatches(item('a'), ctx())).toBe(true);
  });

  it('filtra por club', () => {
    expect(contentItemMatches(item('a', { conditions: { clubIds: ['club-2'] } }), ctx())).toBe(
      false,
    );
  });

  it('filtra por dorsal', () => {
    expect(contentItemMatches(item('a', { conditions: { shirtNumbers: [10] } }), ctx())).toBe(true);
    expect(contentItemMatches(item('a', { conditions: { shirtNumbers: [7] } }), ctx())).toBe(false);
  });

  it('filtra por fase del partido', () => {
    expect(
      contentItemMatches(item('a', { conditions: { matchPhases: ['LIVE'] } }), ctx()),
    ).toBe(false);
    expect(
      contentItemMatches(
        item('a', { conditions: { matchPhases: ['LIVE'] } }),
        ctx({ matchPhase: 'LIVE' }),
      ),
    ).toBe(true);
  });

  it('respeta la ventana de vigencia', () => {
    const futuro = item('a', {
      conditions: { activeFrom: new Date('2026-06-01T00:00:00Z') },
    });
    expect(contentItemMatches(futuro, ctx())).toBe(false);
  });

  it('filtra por numero de interacciones acumuladas', () => {
    expect(contentItemMatches(item('a', { conditions: { minInteractions: 10 } }), ctx())).toBe(
      false,
    );
    expect(contentItemMatches(item('a', { conditions: { minInteractions: 2 } }), ctx())).toBe(true);
  });

  it('filtra por nivel de confianza: no se premia una lectura sospechosa', () => {
    const soloVerificado = item('a', { conditions: { trustLevels: ['VERIFIED'] } });
    expect(contentItemMatches(soloVerificado, ctx({ trustLevel: 'SUSPICIOUS' }))).toBe(false);
  });
});

describe('condiciones geograficas y consentimiento', () => {
  it('una regla con condicion de pais NO aplica sin consentimiento de ubicacion', () => {
    const geo = item('a', { conditions: { countryCodes: ['EC'] } });
    expect(contentItemMatches(geo, ctx({ locationConsent: false }))).toBe(false);
  });

  it('la misma regla aplica con consentimiento', () => {
    const geo = item('a', { conditions: { countryCodes: ['EC'] } });
    expect(contentItemMatches(geo, ctx({ locationConsent: true }))).toBe(true);
  });
});

describe('resolucion y orden', () => {
  it('ordena por prioridad descendente', () => {
    const resolved = resolveContent(
      [item('a', { priority: 1 }), item('b', { priority: 9 }), item('c', { priority: 5 })],
      ctx(),
    );
    expect(resolved.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('limita el numero de items entregados', () => {
    const many = Array.from({ length: 30 }, (_, i) => item(`i${i}`));
    expect(resolveContent(many, ctx(), 5)).toHaveLength(5);
  });

  it('omite medios pesados en modo de bajo consumo de datos', () => {
    const pesado = item('v', {
      kind: 'VIDEO',
      mediaUrl: 'https://cdn.test/v.mp4',
      estimatedMediaBytes: 5_000_000,
    });
    const [resolved] = resolveContent([pesado], ctx({ lowDataMode: true }));
    expect(resolved?.mediaUrl).toBeNull();
    expect(resolved?.mediaOmittedForLowData).toBe(true);
  });

  it('conserva medios ligeros en modo de bajo consumo', () => {
    const ligero = item('i', { mediaUrl: 'https://cdn.test/i.webp', estimatedMediaBytes: 20_000 });
    const [resolved] = resolveContent([ligero], ctx({ lowDataMode: true }));
    expect(resolved?.mediaUrl).toBe('https://cdn.test/i.webp');
  });
});

describe('contenido patrocinado', () => {
  it('se oculta sin consentimiento de analitica de patrocinadores', () => {
    const resolved = resolveContent([item('s', { kind: 'SPONSOR_MESSAGE' }), item('n')], ctx());
    expect(filterSponsoredContent(resolved, false).map((r) => r.id)).toEqual(['n']);
  });

  it('se muestra con consentimiento', () => {
    const resolved = resolveContent([item('s', { kind: 'SPONSOR_MESSAGE' })], ctx());
    expect(filterSponsoredContent(resolved, true)).toHaveLength(1);
  });
});
