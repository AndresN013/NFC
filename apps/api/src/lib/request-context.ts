import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { truncateIp } from '@mev/domain';

/**
 * Derivacion de contexto de una peticion publica.
 *
 * POLITICA DE DATOS: de cada peticion de verificacion se conserva unicamente
 *  - un seudonimo derivado de la IP TRUNCADA (nunca la IP completa),
 *  - un seudonimo de dispositivo derivado de cabeceras poco entropicas,
 *  - el codigo de pais, si una cabecera de CDN lo aporta.
 *
 * No se usa ninguna tecnica de fingerprinting agresiva (canvas, fuentes,
 * lectura de sensores): el proposito es detectar abuso de un identificador, no
 * seguir a una persona entre sitios.
 */

export interface RequestContext {
  /** Seudonimo estable derivado de la IP truncada y una sal rotativa. */
  ipPseudonym: string;
  /** Prefijo de IP truncado, solo para el registro de auditoria administrativa. */
  ipPrefix: string;
  /** Seudonimo de dispositivo. Rota con la sal. */
  deviceFingerprint: string;
  /** Pais aproximado segun cabecera de CDN, si existe. */
  countryCode: string | null;
  /** Idioma preferido normalizado. */
  language: string;
  /** El cliente pidio ahorrar datos (cabecera Save-Data). */
  lowDataMode: boolean;
}

/** Cabeceras de pais que suelen inyectar los CDN mas comunes. */
const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-appengine-country',
  'x-country-code',
];

function pseudonymize(value: string, salt: string, domain: string): string {
  return createHash('sha256').update(`${salt}:${domain}:${value}`).digest('hex').slice(0, 32);
}

export function buildRequestContext(request: FastifyRequest, salt: string): RequestContext {
  const ipPrefix = truncateIp(request.ip ?? '0.0.0.0');

  const countryHeader = COUNTRY_HEADERS.map((h) => request.headers[h]).find(
    (v): v is string => typeof v === 'string' && v.length === 2,
  );

  const userAgent = String(request.headers['user-agent'] ?? '');
  const acceptLanguage = String(request.headers['accept-language'] ?? 'es');

  // La huella combina la IP ya truncada con cabeceras de baja entropia.
  // Es suficiente para contar "cuantos dispositivos distintos" sin permitir
  // reidentificar a una persona concreta.
  const deviceFingerprint = pseudonymize(
    `${ipPrefix}|${userAgent}|${acceptLanguage.split(',')[0]}`,
    salt,
    'device',
  );

  return {
    ipPseudonym: pseudonymize(ipPrefix, salt, 'ip'),
    ipPrefix,
    deviceFingerprint,
    countryCode: countryHeader ? countryHeader.toUpperCase() : null,
    language: normalizeLanguage(acceptLanguage),
    lowDataMode: String(request.headers['save-data'] ?? '').toLowerCase() === 'on',
  };
}

const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** La plataforma es en espanol y esta preparada para mas idiomas. */
export function normalizeLanguage(header: string): SupportedLanguage {
  const primary = header.split(',')[0]?.split('-')[0]?.toLowerCase() ?? 'es';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)
    ? (primary as SupportedLanguage)
    : 'es';
}

/**
 * Huella de un mensaje autenticado, para detectar replay sin almacenar el
 * mensaje completo (que podria reutilizarse si la base de datos se filtrara).
 */
export function fingerprintMessage(message: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:sun:${message}`).digest('hex');
}
