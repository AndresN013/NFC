import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import type { AppConfig } from './config.js';
import dbPlugin from './plugins/db.js';
import errorsPlugin from './plugins/errors.js';
import authPlugin from './auth/plugin.js';
import publicRoutes from './routes/public.js';
import fanRoutes from './routes/fan.js';
import productionRoutes from './routes/production.js';
import adminRoutes from './routes/admin.js';
import supportRoutes from './routes/support.js';
import tagRoutes from './routes/tags.js';
import { openApiBase } from './openapi.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.isProduction ? 'info' : 'debug',
          // POLITICA DE LOGS: no se registran cuerpos, cabeceras de autorizacion
          // ni cadenas de consulta, porque pueden contener tokens.
          // Ver docs/politica-logs.md
          serializers: {
            req: (request) => ({
              method: request.method,
              // Se recorta la ruta: /v/<token> no debe acabar en el registro.
              url: request.url.split('?')[0]?.replace(/\/(v|q)\/[^/]+/, '/$1/[redactado]'),
            }),
            res: (reply) => ({ statusCode: reply.statusCode }),
          },
        },
    // Confia en la cabecera del proxy para obtener la IP del cliente. Debe
    // activarse SOLO detras de un proxy propio; si no, cualquiera falsifica su IP.
    trustProxy: config.isProduction,
    // En pruebas el registro ya esta desactivado por completo (`logger: false`),
    // asi que no hace falta la opcion `disableRequestLogging`, que Fastify 5
    // marca como obsoleta.
    bodyLimit: 256 * 1024,
  });

  await app.register(errorsPlugin);
  await app.register(dbPlugin, { config });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // La API se sirve sobre HTTPS en produccion; HSTS se delega al proxy si
    // este termina TLS, pero se declara aqui como defensa en profundidad.
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    // Lista blanca explicita. No se usa reflexion del Origin.
    origin: [config.FAN_WEB_PUBLIC_URL, config.ADMIN_WEB_PUBLIC_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'Save-Data'],
  });

  await app.register(rateLimit, {
    global: false,
    // La clave por defecto es la IP; las rutas sensibles la refinan.
    keyGenerator: (request) => request.ip,
    addHeaders: { 'retry-after': true },
  });

  await app.register(authPlugin);

  // Modo dinamico: las rutas de la especificacion se derivan de los `schema`
  // declarados en cada endpoint, de modo que no puedan desviarse del codigo.
  await app.register(swagger, { openapi: openApiBase(config) as never });

  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    provider: config.NFC_PROVIDER,
    simulated: config.NFC_PROVIDER === 'mock',
  }));

  app.get('/openapi.json', { config: { rateLimit: false } }, async () => app.swagger());

  await app.register(publicRoutes, { prefix: '/api/v1' });
  await app.register(fanRoutes, { prefix: '/api/v1/fan' });
  await app.register(productionRoutes, { prefix: '/api/v1/production' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  // Cierre del circuito de soporte y privacidad. Comparte prefijo con el panel
  // porque son rutas del mismo consumidor; se separan por archivo para que el
  // codigo de soporte no se pierda dentro de admin.ts.
  await app.register(supportRoutes, { prefix: '/api/v1/admin' });
  // Aprovisionamiento de etiquetas para pilotos con escritor generico.
  await app.register(tagRoutes, { prefix: '/api/v1/admin' });

  return app;
}
