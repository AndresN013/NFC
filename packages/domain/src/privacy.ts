/**
 * Consentimientos y derechos de las personas titulares.
 *
 * Alineado con los principios de la Ley Organica de Proteccion de Datos
 * Personales del Ecuador (LOPDP): licitud, finalidad, minimizacion,
 * proporcionalidad, transparencia, seguridad y consentimiento especifico.
 *
 * NOTA: este codigo implementa controles tecnicos. NO sustituye una evaluacion
 * legal ni el registro de la base de datos ante la autoridad competente. Ver
 * docs/privacidad-lopdp.md para el alcance y las limitaciones.
 */

export const CONSENT_PURPOSES = [
  /** Marketing directo de Marathon (correo, notificaciones). */
  'MARKETING',
  /** Uso de la ubicacion aproximada para contenido y recompensas cercanas. */
  'LOCATION',
  /** Compartir metricas con patrocinadores (SIEMPRE agregadas y seudonimizadas). */
  'SPONSOR_ANALYTICS',
  /** Perfilado de contenido segun historial de interacciones. */
  'PERSONALIZATION',
  /** Comunicaciones del club. */
  'CLUB_COMMUNICATIONS',
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * BASE LEGAL POR FINALIDAD.
 *
 * La verificacion del producto NO aparece aqui a proposito: se ejecuta sin
 * consentimiento y sin cuenta, amparada en el interes legitimo de comprobar la
 * autenticidad de un producto propio y en la ejecucion de la garantia. Un
 * aficionado DEBE poder verificar su jersey sin aceptar nada.
 */
export const CONSENT_REQUIRED: Record<ConsentPurpose, true> = {
  MARKETING: true,
  LOCATION: true,
  SPONSOR_ANALYTICS: true,
  PERSONALIZATION: true,
  CLUB_COMMUNICATIONS: true,
};

export const CONSENT_COPY: Record<ConsentPurpose, { titulo: string; descripcion: string }> = {
  MARKETING: {
    titulo: 'Comunicaciones comerciales de Marathon',
    descripcion:
      'Recibir novedades, lanzamientos y promociones de Marathon por correo electronico. Puede revocarlo cuando quiera.',
  },
  LOCATION: {
    titulo: 'Ubicacion aproximada',
    descripcion:
      'Usar su ubicacion aproximada (ciudad) para mostrarle contenido y recompensas cercanas. Nunca guardamos su ubicacion exacta.',
  },
  SPONSOR_ANALYTICS: {
    titulo: 'Metricas para patrocinadores',
    descripcion:
      'Incluir su actividad en reportes agregados que compartimos con patrocinadores. Los patrocinadores nunca reciben su nombre, correo ni identificadores.',
  },
  PERSONALIZATION: {
    titulo: 'Contenido personalizado',
    descripcion:
      'Adaptar el contenido que ve segun sus interacciones anteriores con sus prendas.',
  },
  CLUB_COMMUNICATIONS: {
    titulo: 'Comunicaciones del club',
    descripcion: 'Recibir informacion del club sobre partidos, convocatorias y eventos.',
  },
};

export interface ConsentRecord {
  purpose: ConsentPurpose;
  granted: boolean;
  grantedAt: Date | null;
  revokedAt: Date | null;
  /** Version del texto informativo aceptado, para poder demostrar el que vio. */
  policyVersion: string;
}

export function hasActiveConsent(
  records: readonly ConsentRecord[],
  purpose: ConsentPurpose,
): boolean {
  const record = records.find((r) => r.purpose === purpose);
  if (!record) return false;
  return record.granted && record.revokedAt == null;
}

/**
 * Funcionalidades que JAMAS pueden condicionarse a un consentimiento.
 * Se comprueba en las pruebas: el consentimiento debe ser libre para ser valido.
 */
export const FEATURES_WITHOUT_CONSENT: readonly string[] = [
  'verificar_jersey',
  'ver_certificado',
  'ver_estado_de_confianza',
  'abrir_caso_de_soporte',
  'consultar_garantia',
];

// --- Derechos de la persona titular ----------------------------------------

export const PRIVACY_REQUEST_TYPES = [
  'ACCESS',
  'RECTIFICATION',
  'DELETION',
  'OPPOSITION',
  'PORTABILITY',
  'CONSENT_WITHDRAWAL',
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];

export const PRIVACY_REQUEST_STATES = [
  'RECEIVED',
  'IDENTITY_PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
] as const;

export type PrivacyRequestState = (typeof PRIVACY_REQUEST_STATES)[number];

/** Plazo interno de atencion, mas estricto que el legal para dar margen. */
export const PRIVACY_REQUEST_SLA_DAYS = 15;

/**
 * Textos en espanol de los tipos y estados de solicitud.
 *
 * Viven aqui y no en cada interfaz porque duplicarlos los hizo divergir: el
 * listado del panel llamaba "Supresion" a lo que el detalle llamaba
 * "Eliminacion de sus datos", y declaraba un tipo `OBJECTION` que el dominio no
 * emite (es `OPPOSITION`), asi que una solicitud de oposicion se mostraba con su
 * valor bruto.
 */
export const PRIVACY_REQUEST_TYPE_COPY: Record<PrivacyRequestType, string> = {
  ACCESS: 'Acceso a sus datos',
  RECTIFICATION: 'Rectificacion de un dato',
  DELETION: 'Eliminacion de sus datos',
  OPPOSITION: 'Oposicion al tratamiento',
  PORTABILITY: 'Portabilidad de sus datos',
  CONSENT_WITHDRAWAL: 'Retiro de consentimiento',
};

export const PRIVACY_REQUEST_STATE_COPY: Record<PrivacyRequestState, string> = {
  RECEIVED: 'Recibida',
  IDENTITY_PENDING: 'Pendiente de verificar identidad',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  REJECTED: 'Rechazada',
};

// --- Retencion --------------------------------------------------------------

/**
 * Politica de retencion por tipo de dato, en dias.
 * `null` = se conserva mientras la cuenta o la unidad exista.
 */
export const RETENTION_DAYS: Record<string, number | null> = {
  /** Detalle tecnico de verificacion (IP seudonimizada, huella de dispositivo). */
  verification_event_detail: 180,
  /** Conteos agregados sin sujeto: se conservan indefinidamente. */
  aggregated_metrics: null,
  /** Alertas de riesgo cerradas. */
  risk_alert_closed: 365,
  /** Registro de auditoria administrativa: exigencia de trazabilidad. */
  audit_event: 1825,
  /** Casos de soporte cerrados. */
  support_case_closed: 730,
  /** Registro de consentimientos: se conserva para poder demostrar su existencia. */
  consent_record: 1825,
};
