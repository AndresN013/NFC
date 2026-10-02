import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga el `.env` de la raiz del monorepo.
 *
 * POR QUE HACE FALTA
 * ------------------
 * Los guiones de `apps/api` (semilla, exportacion de OpenAPI, trabajos
 * asincronos) se ejecutan con el directorio de trabajo en `apps/api`, donde no
 * hay `.env`. El fichero vive en la raiz, porque lo comparten la API, las dos
 * aplicaciones web y Docker Compose.
 *
 * Durante un tiempo esto funciono por accidente: la CLI de Prisma carga el
 * entorno por su cuenta y arrastraba las variables. Invocar un guion
 * directamente con `tsx` fallaba con un `Environment variable not found` que no
 * decia nada sobre la causa real. Cargarlo explicitamente elimina la
 * dependencia de ese efecto colateral.
 *
 * `process.loadEnvFile` NO sobrescribe variables ya definidas, asi que un valor
 * pasado por la linea de comandos o por el entorno de CI sigue teniendo
 * prioridad sobre el fichero.
 */
export function loadRootEnv(): { loaded: string | null } {
  // Se prueba desde el directorio actual hacia arriba: cubre la invocacion desde
  // `apps/api`, desde la raiz y desde un paquete anidado.
  for (const candidate of ['.env', '../.env', '../../.env', '../../../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (!existsSync(path)) continue;
    process.loadEnvFile(path);
    return { loaded: path };
  }
  return { loaded: null };
}

/**
 * Carga el entorno y aborta con un mensaje util si falta lo imprescindible.
 *
 * Un guion que falla con `Environment variable not found: DATABASE_URL` lanzado
 * desde las profundidades de Prisma manda a depurar el lugar equivocado.
 */
export function requireRootEnv(...required: string[]): void {
  const { loaded } = loadRootEnv();

  const missing = required.filter((name) => !process.env[name]);
  if (missing.length === 0) return;

  const causa = loaded
    ? `Se leyo ${loaded}, pero no define: ${missing.join(', ')}.`
    : `No se encontro ningun archivo .env partiendo de ${process.cwd()}.`;

  throw new Error(
    `Falta configuracion para ejecutar este guion. ${causa}\n` +
      'Copie .env.example a .env en la raiz del repositorio y complete los valores.',
  );
}
