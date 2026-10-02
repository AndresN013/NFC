import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { requireRootEnv } from '../lib/load-env.js';

/**
 * Exporta la especificacion OpenAPI a un archivo.
 *
 * La especificacion se DERIVA de los esquemas declarados en cada ruta, no se
 * escribe a mano: asi no puede quedar desincronizada del codigo. Este guion la
 * materializa para poder versionarla o publicarla.
 *
 *   npm run openapi:export -w @mev/api [destino]
 *
 * Requiere PostgreSQL accesible, porque construye la instancia real de la API en
 * lugar de una maqueta: una especificacion derivada de una app que no arranca no
 * demostraria nada.
 */

requireRootEnv('DATABASE_URL', 'SESSION_SECRET', 'TOKEN_HASH_PEPPER', 'ANALYTICS_IP_SALT');

const destino = resolve(process.argv[2] ?? 'openapi.json');

const app = await buildApp(loadConfig());
await app.ready();

const documento = app.swagger();
writeFileSync(destino, `${JSON.stringify(documento, null, 2)}\n`, 'utf8');

const rutas = Object.keys((documento as { paths?: Record<string, unknown> }).paths ?? {});
console.log(`OpenAPI exportado a ${destino} (${rutas.length} rutas)`);

await app.close();
