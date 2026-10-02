import type { AppConfig } from './config.js';

/**
 * Metadatos base de la especificacion OpenAPI.
 *
 * Las rutas se generan dinamicamente a partir de los `schema` declarados en cada
 * endpoint: asi la especificacion no puede desviarse del codigo. Aqui solo vive
 * lo que no se deriva de una ruta concreta.
 */
export function openApiBase(config: AppConfig) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Marathon Escudo Vivo - API',
      version: '0.1.0',
      description: [
        'API del MVP de autenticacion NFC de jerseys.',
        '',
        '## Niveles de confianza',
        'Identificar no es autenticar. El campo `trustLevel` de una verificacion puede ser:',
        '',
        '- `VERIFIED`: el chip ejecuto una operacion criptografica valida.',
        '- `IDENTIFIED_ONLY`: se reconocio el producto sin prueba criptografica (NDEF o QR).',
        '- `SUSPICIOUS`: patron de uso anomalo.',
        '- `UNVERIFIABLE`: no se pudo leer la informacion necesaria.',
        '- `REVOKED`: registro dado de baja.',
        '- `NOT_ACTIVATED`: la unidad aun no salio a la venta.',
        '',
        '## Estado de la integracion criptografica',
        'El adaptador NTAG 424 DNA **no esta implementado**. En este despliegue ninguna',
        'lectura puede producir `VERIFIED`: el maximo alcanzable es `IDENTIFIED_ONLY`.',
        `Proveedor activo: \`${config.NFC_PROVIDER}\`` +
          (config.NFC_PROVIDER === 'mock' ? ' (**SIMULACION**, no hay hardware involucrado).' : '.'),
        '',
        '## Idempotencia',
        'Las operaciones de produccion exigen la cabecera `Idempotency-Key`. Repetir una',
        'peticion con la misma clave y el mismo cuerpo devuelve la respuesta original sin',
        'volver a ejecutar el efecto. La misma clave con otro cuerpo devuelve 409.',
      ].join('\n'),
      contact: { name: 'Equipo Escudo Vivo' },
    },
    servers: [{ url: config.API_PUBLIC_URL, description: 'Servidor actual' }],
    tags: [
      { name: 'publico', description: 'Verificacion y consulta. No requieren cuenta.' },
      { name: 'aficionado', description: 'Cuenta opcional del aficionado.' },
      { name: 'produccion', description: 'Consumidas por la app Android en planta.' },
      { name: 'admin', description: 'Panel administrativo.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http' as const,
          scheme: 'bearer',
          description:
            'Token de sesion emitido por `/admin/login`, `/fan/login` o `/production/auth/login`. ' +
            'El servidor almacena solo su hash.',
        },
      },
    },
  };
}
