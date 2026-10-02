import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Identificadores publicos y secretos.
 *
 * REGLA: existen tres espacios de identificadores separados y NO derivables
 * entre si.
 *
 *  1. `internalId`  - clave primaria (UUID). Nunca sale de la API.
 *  2. `publicRef`   - referencia corta mostrable al aficionado y al soporte.
 *                     No es secreta pero es aleatoria, para impedir enumeracion.
 *  3. `tagToken`    - lo que viaja en la URL del chip. Alta entropia. Se
 *                     almacena SOLO como hash con pimienta.
 *
 * El token del QR de respaldo es un cuarto identificador, distinto del `tagToken`,
 * para que fotografiar un QR no revele el identificador NFC.
 */

/** Alfabeto sin caracteres ambiguos (0/O, 1/I/l) para lectura humana. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Genera una cadena aleatoria con el alfabeto dado, sin sesgo de modulo:
 * descarta los bytes que caerian fuera del mayor multiplo del tamano del alfabeto.
 */
function randomString(length: number, alphabet: string): string {
  const alphabetSize = alphabet.length;
  const maxUnbiased = Math.floor(256 / alphabetSize) * alphabetSize;
  let out = '';
  while (out.length < length) {
    const chunk = randomBytes(length * 2);
    for (const byte of chunk) {
      if (out.length >= length) break;
      if (byte >= maxUnbiased) continue;
      out += alphabet[byte % alphabetSize];
    }
  }
  return out;
}

/**
 * Referencia publica de una unidad: `MEV-XXXXXXXX` (8 simbolos Crockford).
 * 32^8 = 2^40 combinaciones. No es secreta, pero no es enumerable y va
 * protegida por rate limiting.
 */
export function generateUnitPublicRef(): string {
  return `MEV-${randomString(8, CROCKFORD)}`;
}

/**
 * Token que se graba en el chip (registro NDEF) o se entrega al proveedor
 * seguro. 32 bytes de entropia en base64url = 256 bits.
 */
export function generateTagToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Token del QR de respaldo. Deliberadamente distinto del `tagToken` y con
 * menor longitud, porque su nivel de confianza tambien es menor: identifica,
 * no autentica.
 */
export function generateQrToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Token de un solo uso para invitaciones de transferencia de propiedad. */
export function generateTransferToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Hash de token para almacenamiento. Usa SHA-256 con pimienta de servidor.
 *
 * No se usa Argon2/bcrypt porque estos tokens tienen >=128 bits de entropia
 * generada por el servidor: no son adivinables por fuerza bruta y el coste de
 * un KDF lento seria un vector de denegacion de servicio en la ruta de
 * verificacion publica. Las CONTRASENAS de usuario si usan Argon2id (ver API).
 */
export function hashToken(token: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

const HEX_ONLY = /^[0-9a-fA-F]+$/;

/**
 * Comparacion en tiempo constante de dos hashes hexadecimales.
 *
 * Valida el formato ANTES de decodificar: `Buffer.from('zz', 'hex')` devuelve un
 * buffer VACIO en lugar de fallar, y dos buffers vacios son iguales para
 * `timingSafeEqual`. Sin esta validacion, cualquier par de cadenas no
 * hexadecimales de igual longitud se compararia como identico.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  if (!HEX_ONLY.test(a) || !HEX_ONLY.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Enmascara una referencia publica para mostrarla en pantalla.
 * `MEV-A1B2C3D4` -> `MEV-A1B2••••`
 *
 * Se muestran los primeros simbolos para que el aficionado reconozca su prenda,
 * y se ocultan los ultimos para que una captura de pantalla compartida en redes
 * no entregue el identificador completo.
 */
export function maskPublicRef(publicRef: string): string {
  const [prefix, body] = publicRef.split('-');
  if (!body) return '••••••••';
  const visible = body.slice(0, Math.ceil(body.length / 2));
  return `${prefix}-${visible}${'•'.repeat(body.length - visible.length)}`;
}

/**
 * Enmascara un UID de chip. El UID completo NUNCA se expone al aficionado:
 * conocerlo facilita fabricar una etiqueta con UID configurable.
 * Solo el panel administrativo, con rol suficiente, ve el UID completo.
 */
export function maskChipUid(uid: string): string {
  const clean = uid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length <= 4) return '••••';
  return `${clean.slice(0, 2)}${'•'.repeat(clean.length - 4)}${clean.slice(-2)}`;
}

/**
 * Construye la URL que se graba en el chip NDEF.
 * Se mantiene corta porque la memoria util de una NTAG213 son 144 bytes.
 */
export function buildTagUrl(baseUrl: string, tagToken: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}/v/${tagToken}`;
}

export function buildQrUrl(baseUrl: string, qrToken: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}/q/${qrToken}`;
}
