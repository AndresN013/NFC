import { z } from 'zod';

/**
 * Configuracion validada al arrancar.
 *
 * El proceso NO arranca si falta una variable o si un secreto conserva su valor
 * de ejemplo en un entorno que no sea desarrollo. Es preferible fallar al
 * arrancar que servir trafico con un secreto conocido.
 */

const DEV_PLACEHOLDER = /^dev-only-insecure/;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

  SESSION_SECRET: z.string().min(32),
  TOKEN_HASH_PEPPER: z.string().min(32),
  ANALYTICS_IP_SALT: z.string().min(16),

  FAN_WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_WEB_PUBLIC_URL: z.string().url().default('http://localhost:3001'),

  NFC_PROVIDER: z.enum(['mock', 'ntag21x', 'ntag424dna']).default('mock'),

  KMS_PROVIDER: z.enum(['null-kms']).default('null-kms'),
  KMS_KEY_REFERENCE_PREFIX: z.string().default('placeholder'),

  RATE_LIMIT_VERIFY_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(5),
  /**
   * Limite de acciones de escritura del aficionado (reclamos, transferencias,
   * canjes) por hora y por IP.
   *
   * Configurable a proposito: una tienda fisica con muchos clientes detras del
   * mismo NAT necesita un umbral mas alto que un despliegue domestico, y las
   * pruebas de integracion necesitan poder elevarlo sin desactivar el control.
   */
  RATE_LIMIT_FAN_WRITE_PER_HOUR: z.coerce.number().int().positive().default(20),
  /**
   * Limite de envios de formularios publicos (alta de cuenta, casos de soporte,
   * solicitudes de privacidad) por hora y por IP.
   *
   * Configurable por la misma razon que el anterior: una tienda donde muchos
   * clientes comparten IP necesita un umbral mas alto. Y un limite demasiado
   * bajo aqui es peor que en otras rutas, porque impediria a alguien ejercer un
   * derecho o pedir ayuda.
   */
  RATE_LIMIT_PUBLIC_FORMS_PER_HOUR: z.coerce.number().int().positive().default(10),

  VERIFICATION_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
});

export type AppConfig = z.infer<typeof schema> & {
  isProduction: boolean;
  isTest: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Los alojamientos en la nube (Railway, Render, Fly) asignan el puerto en
  // caliente y lo comunican por `PORT`. Un proceso que ignore esa variable
  // escucha donde nadie le habla y el proveedor lo da por caido.
  const parsed = schema.safeParse({
    ...env,
    API_PORT: env.API_PORT ?? env.PORT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuracion invalida. Copie .env.example a .env y complete los valores.\n${issues}`,
    );
  }

  const config = parsed.data;
  const isProduction = config.NODE_ENV === 'production';

  if (isProduction) {
    // Barrera dura: los valores de ejemplo jamas deben llegar a produccion.
    const placeholders = (
      [
        ['SESSION_SECRET', config.SESSION_SECRET],
        ['TOKEN_HASH_PEPPER', config.TOKEN_HASH_PEPPER],
        ['ANALYTICS_IP_SALT', config.ANALYTICS_IP_SALT],
      ] as const
    ).filter(([, value]) => DEV_PLACEHOLDER.test(value));

    if (placeholders.length > 0) {
      throw new Error(
        `Se detectaron secretos de ejemplo en produccion: ${placeholders
          .map(([name]) => name)
          .join(', ')}. Genere valores reales y custodielos en un gestor de secretos.`,
      );
    }

    if (config.NFC_PROVIDER === 'mock') {
      throw new Error(
        'NFC_PROVIDER=mock no puede usarse en produccion: el simulador no produce autenticacion real.',
      );
    }
  }

  return { ...config, isProduction, isTest: config.NODE_ENV === 'test' };
}
