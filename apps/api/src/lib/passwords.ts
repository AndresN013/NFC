import argon2 from 'argon2';

/**
 * Hash de contrasenas de usuario.
 *
 * Argon2id con parametros por encima de los minimos de OWASP (19 MiB, 2
 * iteraciones). Aqui SI se usa un KDF lento, a diferencia de los tokens de alta
 * entropia: una contrasena elegida por una persona es adivinable y necesita el
 * coste; un token de 256 bits generado por el servidor no lo es.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Un hash malformado no debe distinguirse de una contrasena incorrecta.
    return false;
  }
}

/**
 * Comparacion senuelo, para el caso de usuario inexistente.
 *
 * Sin esto, un login contra un correo desconocido responde en microsegundos y
 * uno contra un correo existente tarda decenas de milisegundos: eso permite
 * enumerar cuentas cronometrando la respuesta.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9v';

export async function burnTime(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}

/**
 * Politica minima de contrasena para el personal interno.
 * Se prioriza la longitud sobre la complejidad tipografica, siguiendo NIST
 * SP 800-63B: las reglas de simbolos obligatorios producen contrasenas
 * predecibles sin aumentar la entropia real.
 */
export const PASSWORD_MIN_LENGTH = 12;

export function validatePasswordStrength(plain: string): { ok: boolean; reason?: string } {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `La contrasena debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` };
  }
  if (/^(.)\1+$/.test(plain)) {
    return { ok: false, reason: 'La contrasena no puede ser un unico caracter repetido.' };
  }
  return { ok: true };
}
