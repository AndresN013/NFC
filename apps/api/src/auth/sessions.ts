import { randomBytes } from 'node:crypto';
import type { PrismaClient, Role, ScopeType } from '@prisma/client';
import { hashToken, type RoleAssignment } from '@mev/domain';
import { unauthorized } from '../lib/errors.js';

/**
 * Sesiones de personal interno (panel y app Android) y de aficionados.
 *
 * El token de sesion se genera con 32 bytes de entropia y se guarda SOLO
 * hasheado. Una filtracion de la tabla de sesiones no permite suplantar a nadie.
 */

/** Sesion del panel: suficiente para una jornada, revocable. */
const ADMIN_SESSION_HOURS = 12;

/**
 * Sesion de la app Android: corta a proposito.
 * Un telefono de planta es un dispositivo compartido y expuesto; si se extravia,
 * la ventana de abuso debe ser pequena.
 */
const DEVICE_SESSION_HOURS = 4;

/** Sesion del aficionado: larga, porque el riesgo asociado es bajo. */
const FAN_SESSION_DAYS = 30;

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  assignments: RoleAssignment[];
  sessionId: string;
  deviceId: string | null;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createUserSession(
  db: PrismaClient,
  params: { userId: string; deviceId?: string | null; ipPrefix?: string | null; pepper: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const hours = params.deviceId ? DEVICE_SESSION_HOURS : ADMIN_SESSION_HOURS;
  const expiresAt = new Date(Date.now() + hours * 3_600_000);

  await db.userSession.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(token, params.pepper),
      deviceId: params.deviceId ?? null,
      expiresAt,
      lastIpPrefix: params.ipPrefix ?? null,
    },
  });

  return { token, expiresAt };
}

export async function resolveUserSession(
  db: PrismaClient,
  token: string,
  pepper: string,
): Promise<AuthenticatedUser> {
  const session = await db.userSession.findUnique({
    where: { tokenHash: hashToken(token, pepper) },
    include: { user: { include: { roleAssignments: true } } },
  });

  // Un solo mensaje para todos los fallos: token inexistente, caducado,
  // revocado o de un usuario desactivado son indistinguibles desde fuera.
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized('Sesion invalida o expirada');
  }
  if (!session.user.active || session.user.deletedAt) {
    throw unauthorized('Sesion invalida o expirada');
  }

  // Si la sesion esta ligada a un dispositivo, el dispositivo debe seguir activo.
  if (session.deviceId) {
    const device = await db.authorizedDevice.findUnique({ where: { id: session.deviceId } });
    if (!device || !device.active) {
      throw unauthorized('El dispositivo ya no esta autorizado');
    }
  }

  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    sessionId: session.id,
    deviceId: session.deviceId,
    assignments: session.user.roleAssignments.map((a) => ({
      role: a.role as Role,
      scopeType: a.scopeType as ScopeType,
      scopeId: a.scopeId,
    })),
  };
}

export async function revokeUserSession(db: PrismaClient, sessionId: string): Promise<void> {
  await db.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoca TODAS las sesiones de un usuario. Se usa al desactivarlo. */
export async function revokeAllUserSessions(db: PrismaClient, userId: string): Promise<number> {
  const result = await db.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

// --- Sesiones de aficionado -------------------------------------------------

export interface AuthenticatedFan {
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
  loyaltyTier: number;
  sessionId: string;
}

export async function createFanSession(
  db: PrismaClient,
  params: { fanId: string; pepper: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + FAN_SESSION_DAYS * 86_400_000);

  await db.fanSession.create({
    data: { fanId: params.fanId, tokenHash: hashToken(token, params.pepper), expiresAt },
  });

  return { token, expiresAt };
}

export async function resolveFanSession(
  db: PrismaClient,
  token: string,
  pepper: string,
): Promise<AuthenticatedFan> {
  const session = await db.fanSession.findUnique({
    where: { tokenHash: hashToken(token, pepper) },
    include: { fan: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized('Sesion invalida o expirada');
  }
  if (!session.fan.active || session.fan.deletedAt) {
    throw unauthorized('Sesion invalida o expirada');
  }

  return {
    id: session.fan.id,
    email: session.fan.email,
    displayName: session.fan.displayName,
    locale: session.fan.locale,
    loyaltyTier: session.fan.loyaltyTier,
    sessionId: session.id,
  };
}

/** Limpieza de sesiones caducadas. Job periodico. */
export async function purgeExpiredSessions(db: PrismaClient): Promise<number> {
  const cutoff = new Date();
  const [users, fans] = await Promise.all([
    db.userSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    db.fanSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);
  return users.count + fans.count;
}
