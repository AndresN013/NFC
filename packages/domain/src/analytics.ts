/**
 * Eventos de analitica.
 *
 * PRINCIPIOS (LOPDP Ecuador: finalidad, minimizacion, proporcionalidad):
 *  - Por defecto todo evento es AGREGADO: se guarda el hecho, no la persona.
 *  - El vinculo con una persona solo existe si hay una cuenta y la finalidad lo
 *    exige (por ejemplo, canjear una recompensa).
 *  - La IP se trunca antes de persistirse y ademas se seudonimiza con sal rotativa.
 *  - Ningun evento lleva coordenadas precisas salvo consentimiento LOCATION.
 *  - Los patrocinadores acceden a conteos, nunca a filas individuales.
 */

export const ANALYTICS_EVENTS = [
  'NFC_OPENED',
  'QR_OPENED',
  'VERIFICATION_COMPLETED',
  'CERTIFICATE_VIEWED',
  'JERSEY_CLAIMED',
  'CONTENT_VIEWED',
  'QUIZ_COMPLETED',
  'REWARD_REDEEMED',
  'TRANSFER_STARTED',
  'TRANSFER_COMPLETED',
  'SUPPORT_OPENED',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Clasificacion de cada evento respecto al dato personal.
 *  - AGGREGATE_ONLY: nunca se asocia a una persona identificada.
 *  - PSEUDONYMOUS: se asocia a un identificador seudonimo de sesion/dispositivo.
 *  - IDENTIFIED: requiere cuenta; la finalidad lo justifica y es auditable.
 */
export const EVENT_DATA_CLASS: Record<
  AnalyticsEvent,
  'AGGREGATE_ONLY' | 'PSEUDONYMOUS' | 'IDENTIFIED'
> = {
  NFC_OPENED: 'AGGREGATE_ONLY',
  QR_OPENED: 'AGGREGATE_ONLY',
  VERIFICATION_COMPLETED: 'PSEUDONYMOUS',
  CERTIFICATE_VIEWED: 'AGGREGATE_ONLY',
  JERSEY_CLAIMED: 'IDENTIFIED',
  CONTENT_VIEWED: 'AGGREGATE_ONLY',
  QUIZ_COMPLETED: 'PSEUDONYMOUS',
  REWARD_REDEEMED: 'IDENTIFIED',
  TRANSFER_STARTED: 'IDENTIFIED',
  TRANSFER_COMPLETED: 'IDENTIFIED',
  SUPPORT_OPENED: 'IDENTIFIED',
};

/**
 * Eventos cuyo CONTEO puede exponerse a un patrocinador, limitado a su campana.
 *
 * Lista blanca con una invariante que se comprueba en las pruebas: ningun evento
 * de clase IDENTIFIED entra aqui. La razon es que un evento identificado une una
 * accion con una persona; aunque la API solo devolviese el conteo, el pipeline
 * que lo calcula tendria que atravesar filas personales y cualquier filtro
 * adicional (por modelo, por dia, por ciudad) podria reducir la cohorte hasta
 * individualizarla.
 */
export const SPONSOR_VISIBLE_EVENTS: readonly AnalyticsEvent[] = [
  'CONTENT_VIEWED',
  'QUIZ_COMPLETED',
];

/**
 * Metricas agregadas derivadas que SI puede ver un patrocinador aunque su evento
 * de origen sea IDENTIFIED.
 *
 * Se exponen como un contador precalculado por un job asincrono que ya aplico la
 * supresion de cohortes pequenas (`suppressSmallCohort`) y que nunca devuelve
 * filas. Esta separacion es deliberada: el patrocinador consulta un numero
 * materializado, no una consulta sobre la tabla de eventos.
 */
export const SPONSOR_AGGREGATE_METRICS = [
  /** Numero de canjes de recompensas de la campana. Derivado de REWARD_REDEEMED. */
  'campaign_reward_redemptions',
  /** Numero de vistas de contenido patrocinado. */
  'campaign_content_views',
  /** Numero de trivias completadas. */
  'campaign_quiz_completions',
] as const;

export type SponsorAggregateMetric = (typeof SPONSOR_AGGREGATE_METRICS)[number];

/** Numero minimo de sujetos en un grupo para poder mostrar un agregado. */
export const MIN_AGGREGATE_COHORT_SIZE = 20;

/**
 * Suprime agregados con cohortes demasiado pequenas: con 1 o 2 sujetos, un
 * "agregado" identifica a una persona.
 */
export function suppressSmallCohort(count: number): number | null {
  return count >= MIN_AGGREGATE_COHORT_SIZE ? count : null;
}

/**
 * Trunca una IP antes de persistirla.
 *  - IPv4: se descarta el ultimo octeto  (192.168.1.77  -> 192.168.1.0)
 *  - IPv6: se conservan los primeros 48 bits (3 hextetos)
 *
 * El resultado sigue siendo un dato personal indirecto: se seudonimiza despues
 * con `pseudonymize()` y solo entonces se guarda.
 */
export function truncateIp(ip: string): string {
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::`;
  }
  const octets = ip.split('.');
  if (octets.length !== 4) return '0.0.0.0';
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}
