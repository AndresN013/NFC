import { describe, expect, it } from 'vitest';
import {
  checkUriFits,
  decodeNdefUriMessage,
  encodeNdefUriMessage,
  fromHex,
  selectUriPrefix,
  toHex,
  unwrapType2Tlv,
  URI_PREFIXES,
  wrapType2Tlv,
} from './ndef.js';

describe('abreviatura de prefijos RTD-URI', () => {
  it('elige https:// para una URL sin www', () => {
    const { code, rest } = selectUriPrefix('https://ev.marathon.test/v/ABC');
    expect(code).toBe(0x04);
    expect(rest).toBe('ev.marathon.test/v/ABC');
  });

  it('prefiere el prefijo mas largo cuando hay varios que coinciden', () => {
    // 'https://' (0x04) y 'https://www.' (0x02) coinciden; gana el mas largo.
    const { code, rest } = selectUriPrefix('https://www.marathon.test/x');
    expect(code).toBe(0x02);
    expect(rest).toBe('marathon.test/x');
  });

  it('usa el codigo 0 cuando ningun prefijo aplica', () => {
    const { code, rest } = selectUriPrefix('custom-scheme://algo');
    expect(code).toBe(0x00);
    expect(rest).toBe('custom-scheme://algo');
  });

  it('la tabla tiene los 36 prefijos definidos por el NFC Forum', () => {
    expect(URI_PREFIXES).toHaveLength(36);
    expect(URI_PREFIXES[0x04]).toBe('https://');
    expect(URI_PREFIXES[0x05]).toBe('tel:');
  });
});

describe('codificacion de mensajes NDEF', () => {
  it('produce la cabecera de registro corto esperada', () => {
    const bytes = encodeNdefUriMessage('https://a.test/x');
    // MB(0x80) | ME(0x40) | SR(0x10) | TNF well-known(0x01) = 0xD1
    expect(bytes[0]).toBe(0xd1);
    expect(bytes[1]).toBe(0x01); // longitud del tipo
    expect(bytes[3]).toBe(0x55); // 'U' = RTD URI
    expect(bytes[4]).toBe(0x04); // prefijo https://
  });

  it('el byte de longitud de payload coincide con el contenido real', () => {
    const uri = 'https://a.test/x';
    const bytes = encodeNdefUriMessage(uri);
    const payloadLength = bytes[2]!;
    expect(payloadLength).toBe(bytes.length - 4);
  });

  it('rechaza una URI vacia', () => {
    expect(() => encodeNdefUriMessage('')).toThrow();
  });

  it('usa el formato largo cuando el payload supera 255 bytes', () => {
    const uri = `https://a.test/${'x'.repeat(300)}`;
    const bytes = encodeNdefUriMessage(uri);
    expect(bytes[0]! & 0x10).toBe(0); // sin el flag SR
    expect(decodeNdefUriMessage(bytes)).toBe(uri);
  });
});

describe('ida y vuelta de codificacion', () => {
  const casos = [
    'https://ev.marathon.test/v/8xKq2LmNpRt4',
    'http://www.ejemplo.ec/a',
    'tel:+593999999999',
    'mailto:soporte@ejemplo.ec',
    'custom://sin-prefijo/conocido',
    'https://a.test/con-acentos-ñ-é',
  ];

  for (const uri of casos) {
    it(`preserva ${uri}`, () => {
      expect(decodeNdefUriMessage(encodeNdefUriMessage(uri))).toBe(uri);
    });
  }

  it('preserva la URI a traves del envoltorio TLV completo', () => {
    const uri = 'https://ev.marathon.test/v/TOKEN-DE-PRUEBA';
    const tlv = wrapType2Tlv(encodeNdefUriMessage(uri));
    const message = unwrapType2Tlv(tlv);
    expect(message).not.toBeNull();
    expect(decodeNdefUriMessage(message!)).toBe(uri);
  });
});

describe('decodificacion defensiva', () => {
  it('devuelve null con un buffer demasiado corto', () => {
    expect(decodeNdefUriMessage(new Uint8Array([0xd1, 0x01]))).toBeNull();
  });

  it('devuelve null si el TNF no es well-known', () => {
    const bytes = encodeNdefUriMessage('https://a.test/x');
    bytes[0] = (bytes[0]! & 0xf8) | 0x02; // TNF = MIME
    expect(decodeNdefUriMessage(bytes)).toBeNull();
  });

  it('devuelve null si el tipo no es URI', () => {
    const bytes = encodeNdefUriMessage('https://a.test/x');
    bytes[3] = 0x54; // 'T' = texto
    expect(decodeNdefUriMessage(bytes)).toBeNull();
  });

  it('devuelve null si el codigo de prefijo esta fuera de la tabla', () => {
    const bytes = encodeNdefUriMessage('https://a.test/x');
    bytes[4] = 0x7f;
    expect(decodeNdefUriMessage(bytes)).toBeNull();
  });

  it('devuelve null si la longitud declarada excede el buffer', () => {
    const bytes = encodeNdefUriMessage('https://a.test/x');
    bytes[2] = 0xfe;
    expect(decodeNdefUriMessage(bytes)).toBeNull();
  });
});

describe('envoltorio TLV de Type 2 Tag', () => {
  it('escribe el tag NDEF y el terminador', () => {
    const tlv = wrapType2Tlv(encodeNdefUriMessage('https://a.test/x'));
    expect(tlv[0]).toBe(0x03);
    expect(tlv[tlv.length - 1]).toBe(0xfe);
  });

  it('usa el formato de 3 bytes de longitud cuando supera 254', () => {
    const tlv = wrapType2Tlv(encodeNdefUriMessage(`https://a.test/${'y'.repeat(300)}`));
    expect(tlv[1]).toBe(0xff);
  });

  it('salta los TLV de relleno antes del NDEF', () => {
    const message = encodeNdefUriMessage('https://a.test/x');
    const conRelleno = Uint8Array.from([0x00, 0x00, ...wrapType2Tlv(message)]);
    expect(unwrapType2Tlv(conRelleno)).toEqual(message);
  });

  it('devuelve null en un chip virgen lleno de ceros', () => {
    // Un chip virgen son todo ceros: TLV NULL repetidos, sin NDEF.
    expect(unwrapType2Tlv(new Uint8Array(144))).toBeNull();
  });

  it('devuelve null si solo hay un terminador', () => {
    expect(unwrapType2Tlv(Uint8Array.from([0xfe]))).toBeNull();
  });
});

describe('capacidad de memoria por familia de chip', () => {
  it('una URL de verificacion tipica cabe en una NTAG213', () => {
    const check = checkUriFits('https://ev.mrthn.ec/v/8xKq2LmNpRt4wZ9c', 'NTAG213');
    expect(check.fits).toBe(true);
    expect(check.availableBytes).toBe(144);
  });

  it('una URL excesivamente larga NO cabe en una NTAG213', () => {
    const check = checkUriFits(`https://ev.mrthn.ec/v/${'A'.repeat(200)}`, 'NTAG213');
    expect(check.fits).toBe(false);
    expect(check.requiredBytes).toBeGreaterThan(check.availableBytes);
  });

  it('la misma URL si cabe en una NTAG215', () => {
    expect(checkUriFits(`https://ev.mrthn.ec/v/${'A'.repeat(200)}`, 'NTAG215').fits).toBe(true);
  });

  it('un tipo de chip desconocido no reporta capacidad', () => {
    const check = checkUriFits('https://a.test/x', 'DESCONOCIDO');
    expect(check.fits).toBe(false);
    expect(check.availableBytes).toBe(0);
  });
});

describe('utilidades hexadecimales', () => {
  it('convierte en ambos sentidos', () => {
    const bytes = Uint8Array.from([0x04, 0xa1, 0xff, 0x00]);
    expect(toHex(bytes)).toBe('04A1FF00');
    expect(fromHex('04A1FF00')).toEqual(bytes);
  });

  it('rechaza cadenas de longitud impar', () => {
    expect(() => fromHex('ABC')).toThrow();
  });
});
