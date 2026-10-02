/**
 * Niveles de confianza de una verificacion.
 *
 * PRINCIPIO RECTOR DEL PROYECTO
 * -----------------------------
 * Identificar NO es autenticar.
 *
 * - Identificar = el sistema reconoce a que unidad se refiere un identificador
 *   presentado. Cualquiera que copie ese identificador logra lo mismo.
 * - Autenticar = la unidad demuestra poseer un secreto que no puede extraerse
 *   ni reproducirse trivialmente, mediante una operacion criptografica
 *   ejecutada por el propio chip.
 *
 * Una URL estatica, un UID legible, un codigo QR o una etiqueta NTAG 213 solo
 * permiten IDENTIFICAR. El UID de una NTAG 21x es de solo lectura de fabrica,
 * pero existen en el mercado etiquetas y emuladores con UID configurable, y el
 * contenido NDEF es copiable con cualquier telefono. Por lo tanto NTAG 213/215/216
 * NO constituyen un mecanismo anticlonacion robusto.
 */
export const TRUST_LEVELS = [
  /** El chip ejecuto una operacion criptografica valida y verificable en servidor. */
  'VERIFIED',
  /** Se reconocio el producto, pero sin prueba criptografica (NDEF simple o QR). */
  'IDENTIFIED_ONLY',
  /** El identificador es conocido pero el patron de uso sugiere copia o abuso. */
  'SUSPICIOUS',
  /** No hay datos suficientes para emitir un juicio (payload ilegible, desconocido). */
  'UNVERIFIABLE',
  /** La unidad o el chip fueron revocados administrativamente. */
  'REVOKED',
  /** La unidad existe pero aun no completo el proceso de activacion comercial. */
  'NOT_ACTIVATED',
] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** Nivel de riesgo asociado al resultado, para priorizacion interna. */
export const RISK_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Metodo por el cual llego la evidencia de verificacion.
 * El metodo determina el TECHO de confianza alcanzable.
 */
export const VERIFICATION_METHODS = [
  /** Mensaje autenticado producido por el chip (SUN/CMAC o equivalente). */
  'NFC_CRYPTOGRAPHIC',
  /** Registro NDEF con URL estatica. Copiable. Solo identifica. */
  'NFC_STATIC_URL',
  /** Codigo QR impreso o tejido. Copiable con una fotografia. Solo identifica. */
  'QR_CODE',
  /** Busqueda manual del identificador publico por un agente de soporte. */
  'MANUAL_LOOKUP',
] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/**
 * Techo de confianza por metodo. Ninguna regla posterior puede elevar el
 * resultado por encima de este techo: un QR jamas produce VERIFIED.
 */
export const TRUST_CEILING_BY_METHOD: Record<VerificationMethod, TrustLevel> = {
  NFC_CRYPTOGRAPHIC: 'VERIFIED',
  NFC_STATIC_URL: 'IDENTIFIED_ONLY',
  QR_CODE: 'IDENTIFIED_ONLY',
  MANUAL_LOOKUP: 'IDENTIFIED_ONLY',
};

/** Familias de chip soportadas o contempladas. */
export const CHIP_TYPES = [
  'NTAG213',
  'NTAG215',
  'NTAG216',
  /** Soporta SUN (Secure Unique NFC) message con CMAC. Integracion pendiente. */
  'NTAG424DNA',
  /** Chip detectado pero no reconocido por el catalogo. */
  'UNKNOWN',
] as const;

export type ChipType = (typeof CHIP_TYPES)[number];

/**
 * Indica si una familia de chip es capaz, por diseno, de producir una prueba
 * criptografica verificable en servidor.
 *
 * NTAG 21x no lo es. Esto es una propiedad del hardware, no una configuracion.
 */
export function supportsCryptographicAuthentication(chipType: ChipType): boolean {
  return chipType === 'NTAG424DNA';
}

/**
 * Explicacion en lenguaje llano de cada nivel, apta para mostrar al aficionado.
 * No revela detalles que ayuden a un falsificador.
 */
export const TRUST_LEVEL_COPY: Record<
  TrustLevel,
  { titulo: string; explicacion: string; tono: 'positivo' | 'neutro' | 'alerta' | 'negativo' }
> = {
  VERIFIED: {
    titulo: 'Jersey verificado',
    explicacion:
      'El chip del escudo respondio correctamente a una comprobacion de seguridad. Este es el nivel mas alto de confianza que ofrecemos.',
    tono: 'positivo',
  },
  IDENTIFIED_ONLY: {
    titulo: 'Producto identificado',
    explicacion:
      'Reconocemos este producto en nuestro registro, pero la lectura no incluyo una comprobacion de seguridad. Sirve para consultar informacion, no para confirmar autenticidad.',
    tono: 'neutro',
  },
  SUSPICIOUS: {
    titulo: 'Lectura sospechosa',
    explicacion:
      'Detectamos un patron inusual en las lecturas de este producto. Esto no significa que su jersey sea falso. Le pedimos contactar a soporte para revisarlo.',
    tono: 'alerta',
  },
  UNVERIFIABLE: {
    titulo: 'No se pudo verificar',
    explicacion:
      'No pudimos leer la informacion necesaria. Intente acercar el telefono nuevamente al centro del escudo, o use el codigo de respaldo.',
    tono: 'neutro',
  },
  REVOKED: {
    titulo: 'Producto revocado',
    explicacion:
      'Este registro fue dado de baja. Puede deberse a una devolucion, un reporte de robo o un retiro de produccion. Contacte a soporte.',
    tono: 'negativo',
  },
  NOT_ACTIVATED: {
    titulo: 'Producto todavia no activado',
    explicacion:
      'Este jersey existe en nuestro registro pero aun no ha sido activado para la venta. Si lo acaba de comprar, contacte a soporte.',
    tono: 'neutro',
  },
};

/** Orden de severidad, para elegir el peor resultado entre varias reglas. */
const SEVERITY_ORDER: TrustLevel[] = [
  'VERIFIED',
  'IDENTIFIED_ONLY',
  'UNVERIFIABLE',
  'SUSPICIOUS',
  'NOT_ACTIVATED',
  'REVOKED',
];

export function worstTrustLevel(a: TrustLevel, b: TrustLevel): TrustLevel {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

/** Aplica el techo del metodo: nunca eleva, solo puede degradar. */
export function applyMethodCeiling(level: TrustLevel, method: VerificationMethod): TrustLevel {
  const ceiling = TRUST_CEILING_BY_METHOD[method];
  if (level === 'VERIFIED' && ceiling !== 'VERIFIED') return ceiling;
  return level;
}
