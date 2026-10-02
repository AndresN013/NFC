/**
 * Codificacion y decodificacion de registros NDEF de tipo URI.
 *
 * FUENTE NORMATIVA: NFC Forum, "URI Record Type Definition" (RTD-URI 1.0) y
 * "NFC Data Exchange Format (NDEF) 1.0". La tabla de prefijos de abreviatura y
 * la estructura de cabecera estan definidas en esos documentos publicos.
 *
 * Este modulo es LOGICA PURA: no habla con ningun chip. La entrada/salida real
 * la provee un `TagTransport` (en Android, `android.nfc.tech.Ndef` /
 * `NfcA`). Separarlo asi permite probar la codificacion sin hardware.
 */

/**
 * Tabla de prefijos abreviados de RTD-URI. El indice es el primer byte del
 * payload. Abreviar ahorra bytes, lo cual importa: una NTAG213 tiene 144 bytes
 * de memoria de usuario.
 */
export const URI_PREFIXES: readonly string[] = [
  '', // 0x00 sin abreviatura
  'http://www.', // 0x01
  'https://www.', // 0x02
  'http://', // 0x03
  'https://', // 0x04
  'tel:', // 0x05
  'mailto:', // 0x06
  'ftp://anonymous:anonymous@', // 0x07
  'ftp://ftp.', // 0x08
  'ftps://', // 0x09
  'sftp://', // 0x0A
  'smb://', // 0x0B
  'nfs://', // 0x0C
  'ftp://', // 0x0D
  'dav://', // 0x0E
  'news:', // 0x0F
  'telnet://', // 0x10
  'imap:', // 0x11
  'rtsp://', // 0x12
  'urn:', // 0x13
  'pop:', // 0x14
  'sip:', // 0x15
  'sips:', // 0x16
  'tftp:', // 0x17
  'btspp://', // 0x18
  'btl2cap://', // 0x19
  'btgoep://', // 0x1A
  'tcpobex://', // 0x1B
  'irdaobex://', // 0x1C
  'file://', // 0x1D
  'urn:epc:id:', // 0x1E
  'urn:epc:tag:', // 0x1F
  'urn:epc:pat:', // 0x20
  'urn:epc:raw:', // 0x21
  'urn:epc:', // 0x22
  'urn:nfc:', // 0x23
];

/** Bits de la cabecera de un registro NDEF. */
const MB = 0x80; // Message Begin
const ME = 0x40; // Message End
const SR = 0x10; // Short Record (longitud de payload en 1 byte)
const TNF_WELL_KNOWN = 0x01;
const RTD_URI = 0x55; // 'U'

/** Elige el prefijo abreviado mas largo que coincida, para ahorrar memoria. */
export function selectUriPrefix(uri: string): { code: number; rest: string } {
  let bestCode = 0;
  let bestLength = 0;
  for (let i = 1; i < URI_PREFIXES.length; i += 1) {
    const prefix = URI_PREFIXES[i]!;
    if (uri.startsWith(prefix) && prefix.length > bestLength) {
      bestCode = i;
      bestLength = prefix.length;
    }
  }
  return { code: bestCode, rest: uri.slice(bestLength) };
}

/**
 * Codifica una URI como un mensaje NDEF de un solo registro.
 * Devuelve los bytes del MENSAJE (sin el envoltorio TLV del Type 2 Tag).
 */
export function encodeNdefUriMessage(uri: string): Uint8Array {
  if (uri.length === 0) throw new Error('La URI no puede estar vacia');

  const { code, rest } = selectUriPrefix(uri);
  const restBytes = new TextEncoder().encode(rest);
  const payloadLength = 1 + restBytes.length;

  // Un unico registro: es a la vez principio y fin del mensaje.
  const header = MB | ME | TNF_WELL_KNOWN | (payloadLength < 256 ? SR : 0);

  const out: number[] = [header, 1 /* type length */];

  if (payloadLength < 256) {
    out.push(payloadLength);
  } else {
    out.push(
      (payloadLength >>> 24) & 0xff,
      (payloadLength >>> 16) & 0xff,
      (payloadLength >>> 8) & 0xff,
      payloadLength & 0xff,
    );
  }

  out.push(RTD_URI, code, ...restBytes);
  return Uint8Array.from(out);
}

/** Decodifica un mensaje NDEF de un registro URI. Devuelve null si no lo es. */
export function decodeNdefUriMessage(bytes: Uint8Array): string | null {
  if (bytes.length < 5) return null;

  const header = bytes[0]!;
  const tnf = header & 0x07;
  if (tnf !== TNF_WELL_KNOWN) return null;

  const isShort = (header & SR) !== 0;
  const typeLength = bytes[1]!;
  if (typeLength !== 1) return null;

  let cursor = 2;
  let payloadLength: number;
  if (isShort) {
    payloadLength = bytes[cursor]!;
    cursor += 1;
  } else {
    if (bytes.length < cursor + 4) return null;
    payloadLength =
      ((bytes[cursor]! << 24) >>> 0) +
      (bytes[cursor + 1]! << 16) +
      (bytes[cursor + 2]! << 8) +
      bytes[cursor + 3]!;
    cursor += 4;
  }

  // El flag IL anade un byte de longitud de ID antes del tipo.
  const hasIdLength = (header & 0x08) !== 0;
  let idLength = 0;
  if (hasIdLength) {
    idLength = bytes[cursor]!;
    cursor += 1;
  }

  if (bytes[cursor] !== RTD_URI) return null;
  cursor += 1 + idLength;

  if (payloadLength < 1 || cursor + payloadLength > bytes.length) return null;

  const prefixCode = bytes[cursor]!;
  const prefix = URI_PREFIXES[prefixCode];
  if (prefix === undefined) return null;

  const rest = new TextDecoder().decode(bytes.slice(cursor + 1, cursor + payloadLength));
  return prefix + rest;
}

/**
 * Envuelve un mensaje NDEF en el TLV de un Type 2 Tag (la familia NTAG 21x).
 * Estructura: 0x03 | longitud | mensaje | 0xFE (terminador).
 */
export function wrapType2Tlv(message: Uint8Array): Uint8Array {
  const out: number[] = [0x03];
  if (message.length < 0xff) {
    out.push(message.length);
  } else {
    out.push(0xff, (message.length >>> 8) & 0xff, message.length & 0xff);
  }
  out.push(...message, 0xfe);
  return Uint8Array.from(out);
}

/** Extrae el mensaje NDEF del TLV de un Type 2 Tag. */
export function unwrapType2Tlv(data: Uint8Array): Uint8Array | null {
  let cursor = 0;
  while (cursor < data.length) {
    const tag = data[cursor]!;
    if (tag === 0x00) {
      cursor += 1; // NULL TLV: relleno
      continue;
    }
    if (tag === 0xfe) return null; // terminador sin haber hallado NDEF

    if (cursor + 1 >= data.length) return null;
    let length = data[cursor + 1]!;
    let headerSize = 2;
    if (length === 0xff) {
      if (cursor + 3 >= data.length) return null;
      length = (data[cursor + 2]! << 8) + data[cursor + 3]!;
      headerSize = 4;
    }

    if (tag === 0x03) {
      const start = cursor + headerSize;
      if (start + length > data.length) return null;
      return data.slice(start, start + length);
    }
    cursor += headerSize + length;
  }
  return null;
}

/**
 * Memoria de usuario disponible en cada familia NTAG, en bytes.
 *
 * Valores de las hojas de datos publicas de NXP. Son la memoria de USUARIO
 * (paginas 4..N), no la memoria total del chip.
 */
export const NTAG_USER_MEMORY_BYTES: Record<string, number> = {
  NTAG213: 144,
  NTAG215: 504,
  NTAG216: 888,
};

export interface CapacityCheck {
  fits: boolean;
  requiredBytes: number;
  availableBytes: number;
}

/**
 * Comprueba si una URI cabe en el chip, contando el envoltorio TLV.
 * Se valida ANTES de escribir: una escritura truncada deja el chip inservible.
 */
export function checkUriFits(uri: string, chipType: string): CapacityCheck {
  const available = NTAG_USER_MEMORY_BYTES[chipType] ?? 0;
  const required = wrapType2Tlv(encodeNdefUriMessage(uri)).length;
  return { fits: required <= available, requiredBytes: required, availableBytes: available };
}

/** Utilidad de depuracion: bytes a hexadecimal legible. */
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('Cadena hexadecimal de longitud impar');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
