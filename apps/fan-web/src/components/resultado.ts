import type { TrustLevel } from '@mev/domain/browser';

/**
 * Como se le cuenta a un aficionado lo que acaba de pasar.
 *
 * Los textos estan escritos para alguien que acaba de acercar el telefono a su
 * camiseta, no para un ingeniero. Nada de vocabulario tecnico: ni "payload", ni
 * "token", ni "criptografico".
 *
 * El caso normal y abrumadoramente mayoritario es que la camiseta este bien.
 * Esa lectura tiene que sentirse como una celebracion, no como el resultado de
 * una auditoria.
 */

export interface Resultado {
  /** Titular grande. Lo primero y a veces lo unico que se lee. */
  titulo: string;
  /** Una frase de apoyo. Breve. */
  subtitulo: string;
  /** Simbolo grande del escudo. */
  simbolo: string;
  /** `true` cuando la lectura es buena y la pantalla debe celebrar. */
  celebra: boolean;
  /** Color del acento cuando no se usan los del club. */
  acento: string;
  /** Texto del boton principal, si lo hay. */
  accion?: string;
}

export const RESULTADOS: Record<TrustLevel, Resultado> = {
  VERIFIED: {
    titulo: 'Camiseta verificada',
    subtitulo: 'El escudo respondio a nuestra comprobacion de seguridad.',
    simbolo: '✓',
    celebra: true,
    acento: '#0f9d58',
  },
  IDENTIFIED_ONLY: {
    // Es la lectura normal de una camiseta bien registrada. Se afirma lo que ES
    // cierto y es lo que al aficionado le importa: figura en el registro oficial
    // de Marathon. Sin peros en el titular.
    titulo: 'Camiseta oficial',
    subtitulo: 'Registrada en el sistema oficial de Marathon.',
    simbolo: '✓',
    celebra: true,
    acento: '#0f9d58',
  },
  SUSPICIOUS: {
    titulo: 'Queremos revisarla contigo',
    subtitulo: 'Vimos algo poco habitual en esta camiseta. Escribenos y lo vemos.',
    simbolo: '!',
    celebra: false,
    acento: '#b26a00',
    accion: 'Escribir a Marathon',
  },
  UNVERIFIABLE: {
    titulo: 'Casi lo tenemos',
    subtitulo: 'No pudimos leer el escudo. Acerca el telefono otra vez, sin moverlo.',
    simbolo: '↻',
    celebra: false,
    acento: '#35506b',
    accion: 'Intentar de nuevo',
  },
  REVOKED: {
    titulo: 'Esta camiseta fue dada de baja',
    subtitulo: 'Puede ser por una devolucion o un reporte. Escribenos y te ayudamos.',
    simbolo: '×',
    celebra: false,
    acento: '#97231f',
    accion: 'Escribir a Marathon',
  },
  NOT_ACTIVATED: {
    titulo: 'Todavia no esta activada',
    subtitulo: 'Esta camiseta aun no salio a la venta. Si la acabas de comprar, escribenos.',
    simbolo: '◷',
    celebra: false,
    acento: '#35506b',
    accion: 'Escribir a Marathon',
  },
};

const EDICIONES: Record<string, string> = {
  HOME: 'Local',
  AWAY: 'Visitante',
  THIRD: 'Tercera',
  GOALKEEPER: 'Portero',
  SPECIAL: 'Edicion especial',
  COMMEMORATIVE: 'Conmemorativa',
};

export function nombreEdicion(edicion: string): string {
  return EDICIONES[edicion] ?? edicion;
}

/**
 * Texto del modelo, sin repetir la edicion si el nombre ya la lleva.
 *
 * Los modelos suelen llamarse "Local 2026", asi que anadir la edicion sin mas
 * produce "Local 2026 · Local". Se anade solo cuando aporta algo.
 */
export function textoModelo(modelo: string, edicion: string): string {
  const nombre = nombreEdicion(edicion);
  const yaLoDice = modelo.toLowerCase().includes(nombre.toLowerCase());
  return yaLoDice ? modelo : `${modelo} · ${nombre}`;
}

/**
 * Nombre de temporada sin el prefijo redundante.
 * La etiqueta de la fila ya dice "Temporada"; el valor no tiene que repetirlo.
 */
export function textoTemporada(temporada: string): string {
  return temporada.replace(/^temporada\s+/i, '');
}

/** Fecha larga en espanol. Devuelve null si no hay o es invalida. */
export function fechaLarga(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-EC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Descompone un color hexadecimal en sus canales, como `"11, 61, 46"`.
 *
 * Se usa para poder aplicar el color del club con transparencia desde CSS
 * (`rgba(var(--club-rgb), 0.12)`). La alternativa, `color-mix()`, no existe en
 * los Safari anteriores a 16.2, y esos telefonos siguen leyendo NFC.
 */
export function hexARgb(colorHex: string): string {
  const hex = colorHex.replace('#', '');
  if (hex.length !== 6) return '0, 0, 0';
  const canal = (inicio: number): number => Number.parseInt(hex.slice(inicio, inicio + 2), 16);
  return `${canal(0)}, ${canal(2)}, ${canal(4)}`;
}

/**
 * Decide si el texto sobre el color del club debe ser claro u oscuro.
 *
 * Se usa luminancia relativa en lugar de un umbral sobre el canal verde: con un
 * club de camiseta amarilla, el texto blanco resultaria ilegible.
 */
export function textoSobre(colorHex: string): string {
  const hex = colorHex.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const canal = (inicio: number): number => {
    const v = Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return luminancia > 0.45 ? '#10151a' : '#ffffff';
}
