import { describe, expect, it } from 'vitest';
import {
  buildQrUrl,
  buildTagUrl,
  generateQrToken,
  generateTagToken,
  generateUnitPublicRef,
  hashToken,
  maskChipUid,
  maskPublicRef,
  safeEqualHex,
} from './identifiers.js';

describe('identificadores publicos', () => {
  it('genera referencias con el prefijo y la longitud esperados', () => {
    const ref = generateUnitPublicRef();
    expect(ref).toMatch(/^MEV-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  });

  it('no genera referencias secuenciales ni repetidas', () => {
    const refs = new Set(Array.from({ length: 2000 }, generateUnitPublicRef));
    expect(refs.size).toBe(2000);
  });

  it('evita caracteres ambiguos que confunden al soporte telefonico', () => {
    const body = Array.from({ length: 500 }, generateUnitPublicRef)
      .map((r) => r.split('-')[1])
      .join('');
    expect(body).not.toMatch(/[ILOU]/);
  });
});

describe('tokens de alta entropia', () => {
  it('el token del chip tiene 256 bits', () => {
    expect(Buffer.from(generateTagToken(), 'base64url')).toHaveLength(32);
  });

  it('el token del QR es distinto en espacio y longitud del token del chip', () => {
    expect(Buffer.from(generateQrToken(), 'base64url')).toHaveLength(16);
  });

  it('dos tokens consecutivos no comparten prefijo', () => {
    const a = generateTagToken();
    const b = generateTagToken();
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
  });
});

describe('hash de tokens', () => {
  it('es determinista con la misma pimienta', () => {
    expect(hashToken('abc', 'pepper')).toBe(hashToken('abc', 'pepper'));
  });

  it('cambia por completo si cambia la pimienta', () => {
    expect(hashToken('abc', 'pepper-a')).not.toBe(hashToken('abc', 'pepper-b'));
  });

  it('no contiene el token en claro', () => {
    const token = generateTagToken();
    expect(hashToken(token, 'pepper')).not.toContain(token);
  });

  it('compara en tiempo constante sin lanzar con entradas invalidas', () => {
    expect(safeEqualHex(hashToken('a', 'p'), hashToken('a', 'p'))).toBe(true);
    expect(safeEqualHex(hashToken('a', 'p'), hashToken('b', 'p'))).toBe(false);
    expect(safeEqualHex('zz', 'zz')).toBe(false);
  });
});

describe('enmascarado para pantalla', () => {
  it('oculta la segunda mitad de la referencia publica', () => {
    expect(maskPublicRef('MEV-A1B2C3D4')).toBe('MEV-A1B2••••');
  });

  it('nunca expone el UID completo del chip', () => {
    const uid = '04A2B3C4D5E680';
    const masked = maskChipUid(uid);
    expect(masked).not.toBe(uid);
    expect(masked.startsWith('04')).toBe(true);
    expect(masked.endsWith('80')).toBe(true);
    expect(masked).toContain('•');
  });

  it('soporta UID cortos sin filtrar nada', () => {
    expect(maskChipUid('04A2')).toBe('••••');
  });
});

describe('URLs grabadas en el chip', () => {
  it('construye la URL del chip sin barras duplicadas', () => {
    expect(buildTagUrl('https://ev.marathon.test/', 'TOKEN')).toBe(
      'https://ev.marathon.test/v/TOKEN',
    );
  });

  it('usa una ruta distinta para el QR de respaldo', () => {
    expect(buildQrUrl('https://ev.marathon.test', 'QTOK')).toBe('https://ev.marathon.test/q/QTOK');
  });

  it('la URL cabe en los 144 bytes utiles de una NTAG213', () => {
    const url = buildTagUrl('https://ev.mrthn.ec', generateTagToken());
    // NDEF: cabecera ~7 bytes + abreviatura de esquema https:// (1 byte).
    expect(url.length).toBeLessThan(137);
  });
});
