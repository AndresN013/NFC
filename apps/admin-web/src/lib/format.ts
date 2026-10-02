/**
 * Formateo para tablas y fichas.
 *
 * Regla transversal de accesibilidad: ningun estado se comunica solo con color.
 * Cada estado trae ademas etiqueta en texto y un simbolo, de modo que sea
 * legible en escala de grises, para un usuario con daltonismo y para un lector
 * de pantalla.
 */

import {
  PRIVACY_REQUEST_SLA_DAYS,
  PRIVACY_REQUEST_TYPE_COPY,
  SUPPORT_CASE_STATE_COPY,
} from '@mev/domain/browser';

/** Tono visual de una etiqueta de estado. El color es refuerzo, nunca el mensaje. */
export type Tone = 'neutro' | 'positivo' | 'aviso' | 'peligro';

export interface StateDescriptor {
  /** Texto en espanol que se muestra al usuario. */
  label: string;
  /** Simbolo de apoyo, redundante con el texto. */
  symbol: string;
  tone: Tone;
}

const EM_DASH = '—';

/** Fecha y hora en formato local, o guion cuando no hay valor. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat('es', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/** Solo fecha, para columnas donde la hora es ruido. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(date);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return new Intl.NumberFormat('es').format(value);
}

export function formatBoolean(value: boolean): string {
  return value ? 'Si' : 'No';
}

/** Evita celdas vacias que se confunden con un fallo de carga. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  return String(value);
}

/** Precio en centavos tal y como lo guarda la API. */
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return EM_DASH;
  return new Intl.NumberFormat('es', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Recorta un texto largo para que no reviente el ancho de la tabla. */
export function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** Texto multiidioma de la API: se prefiere espanol, con respaldo a lo que haya. */
export function pickLocalized(
  text: Record<string, string> | null | undefined,
  locale = 'es',
): string {
  if (!text) return EM_DASH;
  const preferred = text[locale];
  if (preferred) return preferred;
  const first = Object.values(text)[0];
  return first ?? EM_DASH;
}

// --- Estados ---------------------------------------------------------------

const UNIT_STATE_DESCRIPTORS: Record<string, StateDescriptor> = {
  PLANNED: { label: 'Planificada', symbol: '·', tone: 'neutro' },
  IN_PRODUCTION: { label: 'En produccion', symbol: '⟳', tone: 'neutro' },
  READY: { label: 'Lista', symbol: '·', tone: 'neutro' },
  ACTIVATED: { label: 'Activada', symbol: '✓', tone: 'positivo' },
  SOLD: { label: 'Vendida', symbol: '✓', tone: 'positivo' },
  QUARANTINED: { label: 'En cuarentena', symbol: '⚠', tone: 'aviso' },
  REVOKED: { label: 'Revocada', symbol: '✕', tone: 'peligro' },
};

export function describeUnitState(state: string): StateDescriptor {
  return UNIT_STATE_DESCRIPTORS[state] ?? { label: state, symbol: '·', tone: 'neutro' };
}

const CHIP_STATE_DESCRIPTORS: Record<string, StateDescriptor> = {
  RECEIVED: { label: 'Recibido', symbol: '·', tone: 'neutro' },
  VALIDATED: { label: 'Validado', symbol: '·', tone: 'neutro' },
  RESERVED: { label: 'Reservado', symbol: '·', tone: 'neutro' },
  PERSONALIZING: { label: 'Personalizando', symbol: '⟳', tone: 'neutro' },
  PROGRAMMED: { label: 'Programado', symbol: '·', tone: 'neutro' },
  VERIFIED: { label: 'Verificado', symbol: '✓', tone: 'positivo' },
  LINKED: { label: 'Vinculado', symbol: '·', tone: 'neutro' },
  READY_FOR_HEAT_PRESS: { label: 'Listo para prensa', symbol: '·', tone: 'neutro' },
  POST_PRESS_PASSED: { label: 'Supero la prensa', symbol: '✓', tone: 'positivo' },
  ACTIVATED: { label: 'Activado', symbol: '✓', tone: 'positivo' },
  QUARANTINED: { label: 'En cuarentena', symbol: '⚠', tone: 'aviso' },
  REVOKED: { label: 'Revocado', symbol: '✕', tone: 'peligro' },
  DESTROYED: { label: 'Destruido', symbol: '✕', tone: 'peligro' },
};

export function describeChipState(state: string): StateDescriptor {
  return CHIP_STATE_DESCRIPTORS[state] ?? { label: state, symbol: '·', tone: 'neutro' };
}

const RISK_LEVEL_DESCRIPTORS: Record<string, StateDescriptor> = {
  NONE: { label: 'Sin riesgo', symbol: '·', tone: 'neutro' },
  LOW: { label: 'Riesgo bajo', symbol: '·', tone: 'neutro' },
  MEDIUM: { label: 'Riesgo medio', symbol: '⚠', tone: 'aviso' },
  HIGH: { label: 'Riesgo alto', symbol: '▲', tone: 'peligro' },
};

export function describeRiskLevel(level: string): StateDescriptor {
  return RISK_LEVEL_DESCRIPTORS[level] ?? { label: level, symbol: '·', tone: 'neutro' };
}

const ALERT_STATE_DESCRIPTORS: Record<string, StateDescriptor> = {
  OPEN: { label: 'Abierta', symbol: '●', tone: 'aviso' },
  IN_REVIEW: { label: 'En revision', symbol: '⟳', tone: 'neutro' },
  CONFIRMED: { label: 'Confirmada', symbol: '▲', tone: 'peligro' },
  DISMISSED: { label: 'Descartada', symbol: '✓', tone: 'positivo' },
};

export function describeAlertState(state: string): StateDescriptor {
  return ALERT_STATE_DESCRIPTORS[state] ?? { label: state, symbol: '·', tone: 'neutro' };
}

const TRUST_LEVEL_LABELS: Record<string, string> = {
  VERIFIED: 'Verificado',
  IDENTIFIED_ONLY: 'Solo identificado',
  SUSPICIOUS: 'Sospechoso',
  UNVERIFIABLE: 'No verificable',
  REVOKED: 'Revocado',
  NOT_ACTIVATED: 'Sin activar',
};

export function trustLevelLabel(level: string): string {
  return TRUST_LEVEL_LABELS[level] ?? level;
}

const METHOD_LABELS: Record<string, string> = {
  NFC_CRYPTOGRAPHIC: 'NFC criptografico',
  NFC_STATIC_URL: 'NFC con URL fija',
  QR_CODE: 'Codigo QR',
  MANUAL_CODE: 'Codigo manual',
};

export function verificationMethodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

const ORDER_STATE_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  OPEN: 'Abierta',
  IN_PROGRESS: 'En curso',
  PAUSED: 'Pausada',
  CLOSED: 'Cerrada',
  CANCELLED: 'Cancelada',
};

export function orderStateLabel(state: string): string {
  return ORDER_STATE_LABELS[state] ?? state;
}

// Etiquetas de tipo de solicitud: se toman del dominio. La copia manual que
// habia aqui decia "Supresion" donde el detalle decia "Eliminacion de sus
// datos", y declaraba un `OBJECTION` que no existe (el tipo real es
// `OPPOSITION`), asi que una oposicion se mostraba con su valor bruto.
const PRIVACY_TYPE_LABELS: Record<string, string> = PRIVACY_REQUEST_TYPE_COPY;

export function privacyTypeLabel(type: string): string {
  return PRIVACY_TYPE_LABELS[type] ?? type;
}

const PRIVACY_STATE_LABELS: Record<string, string> = {
  RECEIVED: 'Recibida',
  IN_PROGRESS: 'En tramite',
  COMPLETED: 'Atendida',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
};

export function privacyStateLabel(state: string): string {
  return PRIVACY_STATE_LABELS[state] ?? state;
}

// Etiquetas de estado: se toman del dominio para que no puedan divergir.
const SUPPORT_STATE_LABELS: Record<string, string> = SUPPORT_CASE_STATE_COPY;

export function supportStateLabel(state: string): string {
  return SUPPORT_STATE_LABELS[state] ?? state;
}

// --- Plazos de privacidad --------------------------------------------------

/** Medianoche local del instante dado, para contar dias de calendario. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export interface DueStatus {
  /** Dias que faltan; negativo si ya paso el plazo. */
  daysLeft: number;
  overdue: boolean;
  label: string;
}

/**
 * Estado del plazo legal de una solicitud de privacidad.
 * El plazo comprometido es `PRIVACY_REQUEST_SLA_DAYS` dias desde la recepcion;
 * una solicitud ya atendida no se marca como vencida.
 */
export function describeDue(
  dueAt: string,
  options: { resolvedAt?: string | null; now?: number } = {},
): DueStatus {
  const now = options.now ?? Date.now();
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return { daysLeft: 0, overdue: false, label: EM_DASH };

  // Se comparan dias de calendario, no horas: un plazo que expira esta tarde
  // "vence hoy", no "queda 1 dia". Contar fracciones de dia hacia arriba hacia
  // ver holgura donde no la hay.
  const daysLeft = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (options.resolvedAt) {
    return { daysLeft, overdue: false, label: 'Atendida' };
  }
  if (daysLeft < 0) {
    const late = Math.abs(daysLeft);
    return {
      daysLeft,
      overdue: true,
      label: `Vencida hace ${late} ${late === 1 ? 'dia' : 'dias'}`,
    };
  }
  if (daysLeft === 0) return { daysLeft, overdue: false, label: 'Vence hoy' };
  return { daysLeft, overdue: false, label: `Quedan ${daysLeft} dias` };
}

/** Plazo comprometido, para mostrarlo en la cabecera de la pagina. */
export const PRIVACY_SLA_DAYS = PRIVACY_REQUEST_SLA_DAYS;

// --- CSV generado en el cliente --------------------------------------------

/**
 * Serializa filas a CSV para los listados que la API no exporta.
 * Escapa comillas, separadores y saltos de linea con las mismas reglas que la API.
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const escape = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ].join('\n');
}

/** Numero total de paginas para un total y tamano dados. */
export function totalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Texto del tipo "6-10 de 42" que acompana a la paginacion. */
export function rangeLabel(total: number, page: number, pageSize: number): string {
  if (total === 0) return 'Sin resultados';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return `${from}-${to} de ${total}`;
}
