import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from './errors.js';

/**
 * Idempotencia de operaciones de escritura.
 *
 * Problema que resuelve: el operario en planta pierde cobertura justo despues
 * de que el servidor reservo un chip. Reintenta. Sin idempotencia, el segundo
 * intento reservaria un chip distinto y el primero quedaria huerfano.
 *
 * Contrato:
 *  - Misma clave + mismo cuerpo -> se devuelve la respuesta original, sin
 *    volver a ejecutar el efecto.
 *  - Misma clave + cuerpo DISTINTO -> error 409. Reutilizar una clave con otro
 *    contenido es casi siempre un fallo del cliente y ejecutarlo seria peor.
 */

const IDEMPOTENCY_TTL_HOURS = 48;

export function hashRequestBody(body: unknown): string {
  // Claves ordenadas para que el mismo objeto con otro orden de propiedades
  // produzca el mismo hash.
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export interface IdempotentResult<T> {
  /** `true` si la respuesta proviene del registro y no de una ejecucion nueva. */
  replayed: boolean;
  statusCode: number;
  body: T;
}

/**
 * Ejecuta `operation` una sola vez por clave.
 *
 * La reserva de la clave se hace con un INSERT que puede fallar por unicidad;
 * asi dos peticiones concurrentes con la misma clave no ejecutan ambas el
 * efecto. La que pierde la carrera espera y devuelve el resultado de la otra.
 */
export async function runIdempotent<T>(
  db: PrismaClient,
  params: {
    key: string;
    endpoint: string;
    body: unknown;
  },
  operation: () => Promise<{ statusCode: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const requestHash = hashRequestBody(params.body);

  const existing = await db.idempotencyRecord.findUnique({ where: { key: params.key } });

  if (existing) {
    if (existing.endpoint !== params.endpoint) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'Esta clave de idempotencia ya se uso en otra operacion.',
        `clave reutilizada: ${existing.endpoint} vs ${params.endpoint}`,
      );
    }
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'Esta clave de idempotencia ya se uso con un contenido diferente.',
        'el hash del cuerpo no coincide con el registrado',
      );
    }
    return {
      replayed: true,
      statusCode: existing.statusCode,
      body: existing.responseBody as T,
    };
  }

  const result = await operation();

  try {
    await db.idempotencyRecord.create({
      data: {
        key: params.key,
        endpoint: params.endpoint,
        requestHash,
        statusCode: result.statusCode,
        responseBody: result.body as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3_600_000),
      },
    });
  } catch (error) {
    // Otra peticion concurrente con la misma clave gano la carrera y ya
    // registro su resultado. Se devuelve el suyo para que ambos clientes vean
    // exactamente la misma respuesta.
    if (isUniqueViolation(error)) {
      const winner = await db.idempotencyRecord.findUnique({ where: { key: params.key } });
      if (winner) {
        return { replayed: true, statusCode: winner.statusCode, body: winner.responseBody as T };
      }
    }
    throw error;
  }

  return { replayed: false, statusCode: result.statusCode, body: result.body };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

/** Limpieza de registros caducados. La ejecuta un job periodico. */
export async function purgeExpiredIdempotencyRecords(db: PrismaClient): Promise<number> {
  const result = await db.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
