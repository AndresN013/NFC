import { describe, expect, it } from 'vitest';
import { PRIVACY_REQUEST_TYPE_COPY } from '@mev/domain/browser';
import {
  describeAlertState,
  describeChipState,
  describeDue,
  describeRiskLevel,
  describeUnitState,
  formatBoolean,
  formatDateTime,
  formatNumber,
  formatPriceCents,
  orDash,
  pickLocalized,
  privacyTypeLabel,
  rangeLabel,
  toCsv,
  totalPages,
  truncate,
  trustLevelLabel,
  verificationMethodLabel,
} from './format';

describe('formateo de celdas', () => {
  it('muestra un guion en lugar de una celda vacia', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('no es una fecha')).toBe('—');
    expect(orDash('')).toBe('—');
    expect(orDash(null)).toBe('—');
    expect(orDash(0)).toBe('0');
    expect(formatNumber(null)).toBe('—');
  });

  it('formatea una fecha ISO valida', () => {
    const text = formatDateTime('2026-02-10T15:00:00.000Z');
    expect(text).not.toBe('—');
    expect(text).toMatch(/2026|26/);
  });

  it('formatea booleanos en espanol', () => {
    expect(formatBoolean(true)).toBe('Si');
    expect(formatBoolean(false)).toBe('No');
  });

  it('convierte centavos a moneda', () => {
    expect(formatPriceCents(4990)).toContain('49');
    expect(formatPriceCents(null)).toBe('—');
  });

  it('recorta textos largos conservando los cortos', () => {
    expect(truncate('corto', 10)).toBe('corto');
    expect(truncate('abcdefghijk', 5)).toBe('abcd…');
  });

  it('elige el texto en espanol de un contenido multiidioma', () => {
    expect(pickLocalized({ es: 'Hola', en: 'Hello' })).toBe('Hola');
    // Sin espanol, cae al primer idioma disponible antes que dejar la celda vacia.
    expect(pickLocalized({ en: 'Hello' })).toBe('Hello');
    expect(pickLocalized(null)).toBe('—');
    expect(pickLocalized({})).toBe('—');
  });
});

describe('estados: nunca solo color', () => {
  it('cada estado de unidad trae etiqueta y simbolo ademas del tono', () => {
    for (const state of ['PLANNED', 'ACTIVATED', 'SOLD', 'QUARANTINED', 'REVOKED']) {
      const descriptor = describeUnitState(state);
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.symbol.length).toBeGreaterThan(0);
      expect(descriptor.label).not.toBe(state);
    }
  });

  it('cada nivel de riesgo trae etiqueta y simbolo', () => {
    for (const level of ['NONE', 'LOW', 'MEDIUM', 'HIGH']) {
      const descriptor = describeRiskLevel(level);
      expect(descriptor.symbol.length).toBeGreaterThan(0);
      expect(descriptor.label).toMatch(/riesgo/i);
    }
  });

  it('distingue riesgo alto de riesgo bajo por texto, no por tono', () => {
    expect(describeRiskLevel('HIGH').label).not.toBe(describeRiskLevel('LOW').label);
    expect(describeRiskLevel('HIGH').symbol).not.toBe(describeRiskLevel('LOW').symbol);
  });

  it('un estado desconocido se muestra en crudo en vez de desaparecer', () => {
    const descriptor = describeUnitState('ESTADO_NUEVO_DE_LA_API');
    expect(descriptor.label).toBe('ESTADO_NUEVO_DE_LA_API');
    expect(descriptor.symbol).toBe('·');
  });

  it('traduce estados de chip y de alerta', () => {
    expect(describeChipState('QUARANTINED').label).toBe('En cuarentena');
    expect(describeAlertState('IN_REVIEW').label).toBe('En revision');
  });

  it('traduce niveles de confianza y metodos de verificacion', () => {
    expect(trustLevelLabel('IDENTIFIED_ONLY')).toBe('Solo identificado');
    expect(verificationMethodLabel('NFC_CRYPTOGRAPHIC')).toBe('NFC criptografico');
    // Un valor no previsto se muestra tal cual.
    expect(trustLevelLabel('OTRO')).toBe('OTRO');
    // Se comprueba la COHERENCIA con el dominio, no un literal: afirmar el texto
    // a mano fue justamente lo que permitio que el listado y el detalle
    // mostraran nombres distintos para el mismo tipo de solicitud.
    expect(privacyTypeLabel('DELETION')).toBe(PRIVACY_REQUEST_TYPE_COPY.DELETION);
    expect(privacyTypeLabel('OPPOSITION')).toBe(PRIVACY_REQUEST_TYPE_COPY.OPPOSITION);
    // Un tipo inexistente se muestra tal cual, no se inventa una etiqueta.
    expect(privacyTypeLabel('OBJECTION')).toBe('OBJECTION');
  });
});

describe('plazo de las solicitudes de privacidad', () => {
  const now = Date.parse('2026-09-17T12:00:00.000Z');

  it('marca vencida una solicitud cuyo plazo ya paso', () => {
    const status = describeDue('2026-09-10T12:00:00.000Z', { now });
    expect(status.overdue).toBe(true);
    expect(status.daysLeft).toBeLessThan(0);
    expect(status.label).toContain('Vencida');
  });

  it('cuenta los dias que faltan', () => {
    const status = describeDue('2026-09-22T12:00:00.000Z', { now });
    expect(status.overdue).toBe(false);
    expect(status.daysLeft).toBe(5);
    expect(status.label).toBe('Quedan 5 dias');
  });

  it('una solicitud ya atendida no se marca como vencida', () => {
    const status = describeDue('2026-09-01T12:00:00.000Z', {
      now,
      resolvedAt: '2026-08-30T12:00:00.000Z',
    });
    expect(status.overdue).toBe(false);
    expect(status.label).toBe('Atendida');
  });

  it('avisa del vencimiento del mismo dia', () => {
    const status = describeDue('2026-09-17T18:00:00.000Z', { now });
    expect(status.label).toBe('Vence hoy');
    expect(status.overdue).toBe(false);
  });

  it('usa singular al vencer por un solo dia', () => {
    const status = describeDue('2026-09-16T11:00:00.000Z', { now });
    expect(status.label).toBe('Vencida hace 1 dia');
  });

  it('una fecha invalida no rompe la tabla', () => {
    expect(describeDue('basura').label).toBe('—');
  });
});

describe('paginacion', () => {
  it('calcula el numero de paginas', () => {
    expect(totalPages(0, 25)).toBe(1);
    expect(totalPages(25, 25)).toBe(1);
    expect(totalPages(26, 25)).toBe(2);
    expect(totalPages(42, 10)).toBe(5);
  });

  it('describe el rango visible', () => {
    expect(rangeLabel(42, 1, 10)).toBe('1-10 de 42');
    expect(rangeLabel(42, 5, 10)).toBe('41-42 de 42');
    expect(rangeLabel(0, 1, 10)).toBe('Sin resultados');
  });
});

describe('CSV generado en el cliente', () => {
  it('escribe cabecera y filas', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\n1,2\n3,4');
  });

  it('entrecomilla separadores, comillas y saltos de linea', () => {
    expect(toCsv(['x'], [['con,coma']])).toBe('x\n"con,coma"');
    expect(toCsv(['x'], [['con;punto']])).toBe('x\n"con;punto"');
    expect(toCsv(['x'], [['dice "hola"']])).toBe('x\n"dice ""hola"""');
    expect(toCsv(['x'], [['dos\nlineas']])).toBe('x\n"dos\nlineas"');
  });

  it('convierte nulos en celda vacia', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,');
  });

  it('sin filas deja solo la cabecera', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });
});
