/**
 * Errores de aplicacion con codigo estable.
 *
 * Los mensajes que llegan al cliente son deliberadamente genericos en las rutas
 * publicas: un mensaje preciso ("ese token no existe" frente a "ese token esta
 * revocado") es un oraculo que ayuda a enumerar.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Detalle interno para el registro. NUNCA se envia al cliente. */
    readonly internalDetail?: string,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = STATUS_BY_CODE[code];
  }
}

export const badRequest = (m: string, d?: string) => new AppError('BAD_REQUEST', m, d);
export const unauthorized = (m = 'Credenciales invalidas', d?: string) =>
  new AppError('UNAUTHORIZED', m, d);
export const forbidden = (m = 'No tiene permiso para esta operacion', d?: string) =>
  new AppError('FORBIDDEN', m, d);
export const notFound = (m = 'Recurso no encontrado', d?: string) =>
  new AppError('NOT_FOUND', m, d);
export const conflict = (m: string, d?: string) => new AppError('CONFLICT', m, d);
export const invalidState = (m: string, d?: string) => new AppError('INVALID_STATE', m, d);
export const notImplemented = (m: string, d?: string) => new AppError('NOT_IMPLEMENTED', m, d);
