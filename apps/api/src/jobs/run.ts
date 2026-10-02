import { PrismaClient } from '@prisma/client';
import { requireRootEnv } from '../lib/load-env.js';
import {
  agregarAnaliticaDiaria,
  aplicarRetencion,
  caducarTransferencias,
  ejecutarTodos,
  limpiarCaducados,
  marcarLotesAnomalos,
  materializarMetricasDeCampana,
} from './index.js';

/**
 * Ejecutor de trabajos asincronos desde la linea de comandos.
 *
 *   npx tsx src/jobs/run.ts todos
 *   npx tsx src/jobs/run.ts retencion
 *
 * Se invoca desde un cron del sistema o un contenedor de tareas. No incluye
 * planificador propio a proposito: ver el comentario de cabecera de index.ts
 */
requireRootEnv('DATABASE_URL');

const db = new PrismaClient();
const nombre = process.argv[2] ?? 'todos';
const hoy = new Date();

const TRABAJOS: Record<string, () => Promise<unknown>> = {
  todos: () => ejecutarTodos(db, hoy),
  analitica: () => agregarAnaliticaDiaria(db, hoy),
  campanas: () => materializarMetricasDeCampana(db, hoy),
  retencion: () => aplicarRetencion(db),
  transferencias: () => caducarTransferencias(db),
  limpieza: () => limpiarCaducados(db),
  lotes: () => marcarLotesAnomalos(db),
};

const trabajo = TRABAJOS[nombre];

if (!trabajo) {
  console.error(
    `Trabajo desconocido: ${nombre}. Disponibles: ${Object.keys(TRABAJOS).join(', ')}`,
  );
  process.exit(1);
}

try {
  const resultado = await trabajo();
  console.log(JSON.stringify(resultado, null, 2));
} catch (error) {
  console.error('El trabajo fallo:', error);
  process.exit(1);
} finally {
  await db.$disconnect();
}
