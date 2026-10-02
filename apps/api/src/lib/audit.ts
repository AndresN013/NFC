import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Registro de auditoria.
 *
 * Solo se anade: la aplicacion nunca actualiza ni borra filas de AuditEvent.
 *
 * POLITICA DE CONTENIDO: `metadata` pasa por un saneador que elimina cualquier
 * clave sospechosa de contener un secreto. Es defensa en profundidad: aunque
 * alguien pase por error un token a esta funcion, no acabara en la base de datos.
 */

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|apikey|api_key|authorization|cookie|pepper|salt|privatekey|private_key|masterkey|master_key|cmac|sdmmac|keyvalue)/i;

/** Claves que son referencias opacas y por tanto SI pueden registrarse. */
const ALLOWED_REFERENCE_KEYS = /^(tokenHash|keyReference|idempotencyKey|referenceId)$/;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[profundidad maxima]';
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) return value.map((v) => sanitizeMetadata(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && !ALLOWED_REFERENCE_KEYS.test(key)) {
        out[key] = '[redactado]';
        continue;
      }
      out[key] = sanitizeMetadata(val, depth + 1);
    }
    return out;
  }

  // Cadenas muy largas se truncan: el registro de auditoria no es un almacen.
  if (typeof value === 'string' && value.length > 512) {
    return `${value.slice(0, 512)}...[truncado]`;
  }

  return value;
}

export interface AuditInput {
  actorId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'FAN' | 'ANONYMOUS';
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipPrefix?: string | null;
}

export async function recordAudit(
  db: PrismaClient | Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? 'USER',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (sanitizeMetadata(input.metadata ?? {}) ?? {}) as Prisma.InputJsonValue,
      ipPrefix: input.ipPrefix ?? null,
    },
  });
}
