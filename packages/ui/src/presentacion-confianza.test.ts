import { describe, expect, it } from 'vitest';
import { TRUST_LEVELS, TRUST_LEVEL_COPY } from '@mev/domain/browser';
import {
  PRESENTACION_CONFIANZA,
  formatearFecha,
  nombreCondicion,
  nombreEdicion,
} from './presentacion-confianza';

describe('presentacion de los niveles de confianza', () => {
  it('cubre los seis niveles del dominio', () => {
    for (const nivel of TRUST_LEVELS) {
      expect(PRESENTACION_CONFIANZA[nivel]).toBeDefined();
    }
  });

  it('NO depende unicamente del color: cada nivel aporta glifo y etiqueta', () => {
    for (const nivel of TRUST_LEVELS) {
      const p = PRESENTACION_CONFIANZA[nivel];
      expect(p.glifo.length).toBeGreaterThan(0);
      expect(p.etiqueta.length).toBeGreaterThan(2);
    }
  });

  it('los glifos son distinguibles entre niveles', () => {
    const glifos = TRUST_LEVELS.map((n) => PRESENTACION_CONFIANZA[n].glifo);
    // Dos niveles con el mismo tono de color deben tener glifos distintos.
    const neutros = TRUST_LEVELS.filter((n) => PRESENTACION_CONFIANZA[n].tono === 'neutro');
    const glifosNeutros = neutros.map((n) => PRESENTACION_CONFIANZA[n].glifo);
    expect(new Set(glifosNeutros).size).toBe(glifosNeutros.length);
    expect(glifos.length).toBe(TRUST_LEVELS.length);
  });

  it('las etiquetas son distintas entre si', () => {
    const etiquetas = TRUST_LEVELS.map((n) => PRESENTACION_CONFIANZA[n].etiqueta);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });

  it('reutiliza los textos del dominio en lugar de duplicarlos', () => {
    for (const nivel of TRUST_LEVELS) {
      expect(PRESENTACION_CONFIANZA[nivel].titulo).toBe(TRUST_LEVEL_COPY[nivel].titulo);
      expect(PRESENTACION_CONFIANZA[nivel].explicacion).toBe(TRUST_LEVEL_COPY[nivel].explicacion);
    }
  });

  it('la etiqueta de IDENTIFIED_ONLY no afirma autenticidad', () => {
    const etiqueta = PRESENTACION_CONFIANZA.IDENTIFIED_ONLY.etiqueta.toLowerCase();
    expect(etiqueta).not.toContain('autentic');
    expect(etiqueta).not.toContain('verificado');
    // Debe decir explicitamente que falta la comprobacion criptografica.
    expect(etiqueta).toContain('sin verificacion');
  });

  it('solo los estados que exigen atencion usan aria-live assertive', () => {
    expect(PRESENTACION_CONFIANZA.SUSPICIOUS.urgencia).toBe('assertive');
    expect(PRESENTACION_CONFIANZA.REVOKED.urgencia).toBe('assertive');
    expect(PRESENTACION_CONFIANZA.VERIFIED.urgencia).toBe('polite');
    expect(PRESENTACION_CONFIANZA.IDENTIFIED_ONLY.urgencia).toBe('polite');
  });

  it('VERIFIED es el unico nivel con tono de exito', () => {
    const exitos = TRUST_LEVELS.filter((n) => PRESENTACION_CONFIANZA[n].tono === 'exito');
    expect(exitos).toEqual(['VERIFIED']);
  });
});

describe('formateo', () => {
  it('formatea una fecha ISO en espanol', () => {
    const texto = formatearFecha('2026-02-10T15:00:00.000Z');
    expect(texto).toContain('2026');
    expect(texto).toContain('febrero');
  });

  it('devuelve null si la fecha falta', () => {
    expect(formatearFecha(null)).toBeNull();
    expect(formatearFecha(undefined)).toBeNull();
  });

  it('devuelve null si la fecha es invalida en lugar de mostrar basura', () => {
    expect(formatearFecha('no-es-una-fecha')).toBeNull();
  });

  it('traduce las ediciones conocidas y deja pasar las desconocidas', () => {
    expect(nombreEdicion('HOME')).toBe('Local');
    expect(nombreEdicion('GOALKEEPER')).toBe('Portero');
    expect(nombreEdicion('FUTURO_DESCONOCIDO')).toBe('FUTURO_DESCONOCIDO');
  });

  it('traduce las condiciones de la prenda', () => {
    expect(nombreCondicion('NEW')).toBe('Nueva');
    expect(nombreCondicion('TRANSFERRED')).toBe('Transferida');
  });
});
