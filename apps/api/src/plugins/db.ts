import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
    config: AppConfig;
  }
}

export default fp(async function dbPlugin(app: FastifyInstance, opts: { config: AppConfig }) {
  const db = new PrismaClient({
    datasources: { db: { url: opts.config.DATABASE_URL } },
    // En desarrollo se registran las consultas lentas; nunca sus parametros,
    // que pueden contener tokens. Ver docs/politica-logs.md
    log: opts.config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

  await db.$connect();

  app.decorate('db', db);
  app.decorate('config', opts.config);

  app.addHook('onClose', async () => {
    await db.$disconnect();
  });
});
