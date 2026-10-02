/**
 * Maquinas de estado del ciclo de vida fisico y comercial.
 *
 * Las transiciones son explicitas y validadas: la API rechaza cualquier salto
 * no declarado aqui. Esto es lo que permite que las operaciones de produccion
 * sean idempotentes y auditables.
 */

export const CHIP_STATES = [
  /** El chip llego a la planta dentro de un lote del proveedor. */
  'RECEIVED',
  /** Se inspecciono y el tipo declarado coincide con el detectado. */
  'VALIDATED',
  /** Asignado a una orden de produccion; ningun otro puesto puede tomarlo. */
  'RESERVED',
  /** Operacion de escritura en curso (estado transitorio, con expiracion). */
  'PERSONALIZING',
  /** La escritura reporto exito. Todavia sin relectura de confirmacion. */
  'PROGRAMMED',
  /** Relectura posterior a la escritura correcta. */
  'VERIFIED',
  /** Vinculado a un emblema y a una unidad de jersey concreta. */
  'LINKED',
  /** Listo para pasar por la prensa de termosellado. */
  'READY_FOR_HEAT_PRESS',
  /** Supero la lectura posterior al calor. */
  'POST_PRESS_PASSED',
  /** Activado comercialmente: la web del aficionado ya puede verificarlo. */
  'ACTIVATED',
  /** Retenido por una anomalia. Requiere decision humana. */
  'QUARANTINED',
  /** Dado de baja definitivamente por seguridad o devolucion. */
  'REVOKED',
  /** Destruido fisicamente y registrado como tal. */
  'DESTROYED',
] as const;

export type ChipState = (typeof CHIP_STATES)[number];

/**
 * Transiciones permitidas. Cualquier par ausente es un error 409.
 *
 * QUARANTINED es alcanzable desde casi cualquier estado operativo porque una
 * anomalia puede detectarse en cualquier momento. REVOKED y DESTROYED son
 * terminales salvo la rehabilitacion explicita desde cuarentena.
 */
export const CHIP_TRANSITIONS: Record<ChipState, readonly ChipState[]> = {
  RECEIVED: ['VALIDATED', 'QUARANTINED', 'DESTROYED'],
  VALIDATED: ['RESERVED', 'QUARANTINED', 'DESTROYED'],
  RESERVED: ['PERSONALIZING', 'VALIDATED', 'QUARANTINED'],
  // Reintento seguro: PERSONALIZING -> PERSONALIZING permite repetir la escritura
  // con la misma clave de idempotencia tras un fallo de comunicacion NFC.
  PERSONALIZING: ['PERSONALIZING', 'PROGRAMMED', 'RESERVED', 'QUARANTINED'],
  PROGRAMMED: ['VERIFIED', 'PERSONALIZING', 'QUARANTINED'],
  VERIFIED: ['LINKED', 'QUARANTINED'],
  LINKED: ['READY_FOR_HEAT_PRESS', 'QUARANTINED'],
  READY_FOR_HEAT_PRESS: ['POST_PRESS_PASSED', 'QUARANTINED'],
  POST_PRESS_PASSED: ['ACTIVATED', 'QUARANTINED'],
  ACTIVATED: ['REVOKED', 'QUARANTINED'],
  QUARANTINED: ['VALIDATED', 'RESERVED', 'LINKED', 'ACTIVATED', 'REVOKED', 'DESTROYED'],
  REVOKED: ['DESTROYED'],
  DESTROYED: [],
};

export function canTransitionChip(from: ChipState, to: ChipState): boolean {
  return (CHIP_TRANSITIONS[from] ?? []).includes(to);
}

export class InvalidStateTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Transicion invalida de ${entity}: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export function assertChipTransition(from: ChipState, to: ChipState): void {
  if (!canTransitionChip(from, to)) {
    throw new InvalidStateTransitionError('NfcChip', from, to);
  }
}

/** Estados en los que el chip todavia no debe producir lecturas de aficionados. */
export const PRE_RETAIL_CHIP_STATES: readonly ChipState[] = [
  'RECEIVED',
  'VALIDATED',
  'RESERVED',
  'PERSONALIZING',
  'PROGRAMMED',
  'VERIFIED',
  'LINKED',
  'READY_FOR_HEAT_PRESS',
  'POST_PRESS_PASSED',
];

// --- Unidad de jersey -------------------------------------------------------

export const JERSEY_UNIT_STATES = [
  'PLANNED',
  'IN_PRODUCTION',
  'READY',
  'ACTIVATED',
  'SOLD',
  'QUARANTINED',
  'REVOKED',
] as const;

export type JerseyUnitState = (typeof JERSEY_UNIT_STATES)[number];

export const JERSEY_UNIT_TRANSITIONS: Record<JerseyUnitState, readonly JerseyUnitState[]> = {
  PLANNED: ['IN_PRODUCTION', 'QUARANTINED'],
  IN_PRODUCTION: ['READY', 'QUARANTINED'],
  READY: ['ACTIVATED', 'QUARANTINED'],
  ACTIVATED: ['SOLD', 'QUARANTINED', 'REVOKED'],
  SOLD: ['QUARANTINED', 'REVOKED'],
  QUARANTINED: ['READY', 'ACTIVATED', 'SOLD', 'REVOKED'],
  REVOKED: [],
};

export function canTransitionJerseyUnit(from: JerseyUnitState, to: JerseyUnitState): boolean {
  return (JERSEY_UNIT_TRANSITIONS[from] ?? []).includes(to);
}

export function assertJerseyUnitTransition(from: JerseyUnitState, to: JerseyUnitState): void {
  if (!canTransitionJerseyUnit(from, to)) {
    throw new InvalidStateTransitionError('JerseyUnit', from, to);
  }
}

/**
 * Condicion declarada de la prenda. Alimenta el contenido dinamico.
 */
export const UNIT_CONDITIONS = ['NEW', 'GIFTED', 'USED', 'TRANSFERRED', 'COLLECTION'] as const;
export type UnitCondition = (typeof UNIT_CONDITIONS)[number];

// --- Transferencia de propiedad ---------------------------------------------

export const TRANSFER_STATES = [
  'PENDING',
  'ACCEPTED',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

// --- Orden de produccion ----------------------------------------------------

export const PRODUCTION_ORDER_STATES = [
  'DRAFT',
  'OPEN',
  'IN_PROGRESS',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProductionOrderState = (typeof PRODUCTION_ORDER_STATES)[number];

export const PRODUCTION_ORDER_TRANSITIONS: Record<
  ProductionOrderState,
  readonly ProductionOrderState[]
> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['IN_PROGRESS', 'PAUSED', 'CANCELLED'],
  IN_PROGRESS: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionProductionOrder(
  from: ProductionOrderState,
  to: ProductionOrderState,
): boolean {
  return (PRODUCTION_ORDER_TRANSITIONS[from] ?? []).includes(to);
}

// --- Casos de soporte -------------------------------------------------------

/**
 * Estados de un caso de soporte.
 *
 * Viven en el dominio, y no solo en el esquema de Prisma, porque el panel los
 * necesita para etiquetarlos y filtrarlos. Cuando el panel los redeclaraba por
 * su cuenta acabo mostrando estados que la API nunca emite.
 */
export const SUPPORT_CASE_STATES = [
  'OPEN',
  'IN_PROGRESS',
  /** Se respondio al cliente y se espera su reaccion. */
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;

export type SupportCaseState = (typeof SUPPORT_CASE_STATES)[number];

/**
 * Transiciones permitidas de un caso.
 *
 * Reabrir un caso CERRADO no esta permitido: si el problema vuelve, es un caso
 * nuevo, y asi el historial refleja cuantas veces ocurrio de verdad en lugar de
 * esconderlo dentro de un unico caso eterno.
 */
export const SUPPORT_CASE_TRANSITIONS: Record<SupportCaseState, readonly SupportCaseState[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

export function canTransitionSupportCase(
  from: SupportCaseState,
  to: SupportCaseState,
): boolean {
  return (SUPPORT_CASE_TRANSITIONS[from] ?? []).includes(to);
}

/** Motivos por los que un aficionado abre un caso. */
export const SUPPORT_CASE_REASONS = [
  'AUTHENTICITY_DOUBT',
  'WARRANTY',
  'NFC_NOT_READING',
  'TRANSFER_ISSUE',
  'OTHER',
] as const;

export type SupportCaseReason = (typeof SUPPORT_CASE_REASONS)[number];

/** Textos en espanol, para que la interfaz no los reinvente. */
export const SUPPORT_CASE_REASON_COPY: Record<SupportCaseReason, string> = {
  AUTHENTICITY_DOUBT: 'Dudas sobre la autenticidad de la prenda',
  WARRANTY: 'Uso de la garantia',
  NFC_NOT_READING: 'El escudo no responde al telefono',
  TRANSFER_ISSUE: 'Problema con una transferencia de titularidad',
  OTHER: 'Otro motivo',
};

export const SUPPORT_CASE_STATE_COPY: Record<SupportCaseState, string> = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En curso',
  WAITING_CUSTOMER: 'Esperando al cliente',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
};
