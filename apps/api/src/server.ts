import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { loadRootEnv } from './lib/load-env.js';

/**
 * Carga el `.env` de la raiz antes de validar la configuracion.
 *
 * El fichero vive en la raiz del monorepo porque lo comparten la API, las dos
 * aplicaciones web y Docker Compose; pero `npm run dev` ejecuta este proceso con
 * el directorio de trabajo en `apps/api`. Sin esta llamada, el arranque falla con
 * un error de configuracion aunque el `.env` exista.
 *
 * En produccion no estorba: `loadEnvFile` no sobrescribe variables ya presentes,
 * asi que las inyectadas por el orquestador mandan, y si no hay fichero no pasa
 * nada.
 */
loadRootEnv();

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'cerrando servidor');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(
    { provider: config.NFC_PROVIDER },
    config.NFC_PROVIDER === 'mock'
      ? 'API iniciada con el proveedor NFC SIMULADO: ninguna verificacion sera autenticacion real'
      : 'API iniciada',
  );
} catch (error) {
  app.log.error(error, 'no se pudo iniciar la API');
  process.exit(1);
}
