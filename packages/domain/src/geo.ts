/**
 * Utilidades geograficas para el motor de riesgo.
 *
 * PRIVACIDAD: el sistema NUNCA almacena coordenadas precisas del aficionado sin
 * consentimiento explicito. Para el analisis de riesgo se usa unicamente el pais
 * y, como maximo, una region administrativa, derivados de la IP (que a su vez se
 * almacena truncada). El centroide de pais es una aproximacion grosera
 * deliberada: sirve para descartar viajes fisicamente imposibles entre
 * continentes, no para localizar a nadie.
 */

export interface ApproximateLocation {
  /** ISO 3166-1 alpha-2, por ejemplo 'EC'. */
  countryCode: string;
  /** Region administrativa opcional, por ejemplo 'Pichincha'. */
  region?: string | null;
}

/** Centroides aproximados. Precision intencionalmente baja (grado entero). */
const COUNTRY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  EC: { lat: -1, lon: -78 },
  CO: { lat: 4, lon: -73 },
  PE: { lat: -10, lon: -76 },
  US: { lat: 39, lon: -98 },
  ES: { lat: 40, lon: -4 },
  MX: { lat: 23, lon: -102 },
  AR: { lat: -34, lon: -64 },
  BR: { lat: -14, lon: -51 },
  CL: { lat: -33, lon: -71 },
  CN: { lat: 35, lon: 105 },
  IT: { lat: 42, lon: 12 },
  DE: { lat: 51, lon: 10 },
  VE: { lat: 8, lon: -66 },
  PA: { lat: 9, lon: -80 },
};

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distancia de gran circulo entre dos puntos, en kilometros. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distancia aproximada entre dos paises. Devuelve null si alguno de los dos
 * no esta en el catalogo: preferimos no emitir juicio antes que inventar uno.
 */
export function approximateCountryDistanceKm(from: string, to: string): number | null {
  const a = COUNTRY_CENTROIDS[from.toUpperCase()];
  const b = COUNTRY_CENTROIDS[to.toUpperCase()];
  if (!a || !b) return null;
  return haversineKm(a, b);
}

/**
 * Velocidad maxima considerada plausible, en km/h.
 *
 * 900 km/h es la velocidad de crucero de un avion comercial. Se usa un margen
 * generoso (1000) mas una tolerancia fija de 2 horas para cubrir el error del
 * centroide, la imprecision de la geolocalizacion por IP, las VPN y las escalas.
 */
const MAX_PLAUSIBLE_SPEED_KMH = 1000;
const TRAVEL_TOLERANCE_HOURS = 2;

export interface ImpossibleTravelInput {
  previousCountry: string;
  previousAt: Date;
  currentCountry: string;
  currentAt: Date;
}

export interface ImpossibleTravelResult {
  /** true solo si el desplazamiento es fisicamente imposible con margen amplio. */
  impossible: boolean;
  distanceKm: number | null;
  elapsedHours: number;
  impliedSpeedKmh: number | null;
}

/**
 * Detecta desplazamientos fisicamente imposibles entre dos lecturas.
 *
 * ADVERTENCIA DE DISENO: este indicador por si solo NO declara falso un jersey.
 * Una VPN, un roaming mal geolocalizado o un proxy corporativo producen el mismo
 * patron. El motor de riesgo lo trata como senal de apoyo, nunca como veredicto.
 */
export function detectImpossibleTravel(input: ImpossibleTravelInput): ImpossibleTravelResult {
  const elapsedMs = input.currentAt.getTime() - input.previousAt.getTime();
  const elapsedHours = Math.max(0, elapsedMs / 3_600_000);
  const distanceKm = approximateCountryDistanceKm(input.previousCountry, input.currentCountry);

  if (distanceKm == null) {
    return { impossible: false, distanceKm: null, elapsedHours, impliedSpeedKmh: null };
  }
  if (distanceKm < 500) {
    // Dentro del error del centroide: no se emite juicio.
    return { impossible: false, distanceKm, elapsedHours, impliedSpeedKmh: null };
  }

  const effectiveHours = elapsedHours + TRAVEL_TOLERANCE_HOURS;
  const impliedSpeedKmh = distanceKm / effectiveHours;

  return {
    impossible: impliedSpeedKmh > MAX_PLAUSIBLE_SPEED_KMH,
    distanceKm,
    elapsedHours,
    impliedSpeedKmh,
  };
}

/** Paises donde se espera actividad normal del piloto. */
export const PILOT_EXPECTED_COUNTRIES: readonly string[] = ['EC'];
/** Paises limitrofes y de diaspora frecuente: normales, sin penalizacion fuerte. */
export const PILOT_ADJACENT_COUNTRIES: readonly string[] = ['CO', 'PE', 'US', 'ES'];
