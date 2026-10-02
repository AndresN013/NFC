import { TRUST_LEVEL_COPY, type TrustLevel } from '@mev/domain/browser';

/**
 * Presentacion de cada nivel de confianza.
 *
 * REGLA DE ACCESIBILIDAD: el color NUNCA es el unico portador del significado.
 * Cada nivel aporta ademas un glifo y una etiqueta textual, de modo que el
 * estado se entiende en escala de grises, con daltonismo o con un lector de
 * pantalla. Las pruebas comprueban esta invariante.
 */

export interface PresentacionConfianza {
  /** Clave de color, resuelta a variables CSS en el componente. */
  tono: 'exito' | 'neutro' | 'alerta' | 'error';
  /** Glifo textual. No es una imagen: se lee y se copia. */
  glifo: string;
  /** Etiqueta corta e inequivoca, independiente del color. */
  etiqueta: string;
  /** Titulo largo, tomado del dominio para no duplicar la redaccion. */
  titulo: string;
  /** Explicacion en lenguaje llano, tomada del dominio. */
  explicacion: string;
  /** `polite` para estados informativos, `assertive` cuando exige atencion. */
  urgencia: 'polite' | 'assertive';
}

export const PRESENTACION_CONFIANZA: Record<TrustLevel, PresentacionConfianza> = {
  VERIFIED: {
    tono: 'exito',
    glifo: '✓',
    etiqueta: 'Verificado',
    titulo: TRUST_LEVEL_COPY.VERIFIED.titulo,
    explicacion: TRUST_LEVEL_COPY.VERIFIED.explicacion,
    urgencia: 'polite',
  },
  IDENTIFIED_ONLY: {
    tono: 'neutro',
    glifo: 'i',
    // Deliberadamente NO dice "autentico": identificar no es autenticar.
    etiqueta: 'Identificado, sin verificacion criptografica',
    titulo: TRUST_LEVEL_COPY.IDENTIFIED_ONLY.titulo,
    explicacion: TRUST_LEVEL_COPY.IDENTIFIED_ONLY.explicacion,
    urgencia: 'polite',
  },
  SUSPICIOUS: {
    tono: 'alerta',
    glifo: '!',
    etiqueta: 'Lectura sospechosa',
    titulo: TRUST_LEVEL_COPY.SUSPICIOUS.titulo,
    explicacion: TRUST_LEVEL_COPY.SUSPICIOUS.explicacion,
    urgencia: 'assertive',
  },
  UNVERIFIABLE: {
    tono: 'neutro',
    glifo: '?',
    etiqueta: 'No verificable',
    titulo: TRUST_LEVEL_COPY.UNVERIFIABLE.titulo,
    explicacion: TRUST_LEVEL_COPY.UNVERIFIABLE.explicacion,
    urgencia: 'polite',
  },
  REVOKED: {
    tono: 'error',
    glifo: '×',
    etiqueta: 'Revocado',
    titulo: TRUST_LEVEL_COPY.REVOKED.titulo,
    explicacion: TRUST_LEVEL_COPY.REVOKED.explicacion,
    urgencia: 'assertive',
  },
  NOT_ACTIVATED: {
    tono: 'neutro',
    glifo: '–',
    etiqueta: 'No activado',
    titulo: TRUST_LEVEL_COPY.NOT_ACTIVATED.titulo,
    explicacion: TRUST_LEVEL_COPY.NOT_ACTIVATED.explicacion,
    urgencia: 'polite',
  },
};

/** Formatea una fecha ISO para mostrarla en espanol. Devuelve null si falta. */
export function formatearFecha(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-EC', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const EDICIONES: Record<string, string> = {
  HOME: 'Local',
  AWAY: 'Visitante',
  THIRD: 'Tercera',
  GOALKEEPER: 'Portero',
  SPECIAL: 'Especial',
  COMMEMORATIVE: 'Conmemorativa',
};

export function nombreEdicion(edicion: string): string {
  return EDICIONES[edicion] ?? edicion;
}

const CONDICIONES: Record<string, string> = {
  NEW: 'Nueva',
  GIFTED: 'Regalada',
  USED: 'Usada',
  TRANSFERRED: 'Transferida',
  COLLECTION: 'De coleccion',
};

export function nombreCondicion(condicion: string): string {
  return CONDICIONES[condicion] ?? condicion;
}
