import type { PrismaClient } from '@prisma/client';
import {
  MIN_AGGREGATE_COHORT_SIZE,
  RETENTION_DAYS,
  suppressSmallCohort,
} from '@mev/domain';
import { purgeExpiredIdempotencyRecords } from '../lib/idempotency.js';
import { purgeExpiredSessions } from '../auth/sessions.js';

/**
 * Trabajos asincronos.
 *
 * Deliberadamente son funciones puras de efecto, sin planificador acoplado: se
 * invocan desde un cron del sistema, un contenedor de tareas o una prueba. Meter
 * aqui un planificador propio complicaria el despliegue del piloto sin
 * beneficio, y ataria la logica a una libreria concreta.
 *
 * Ejecutar por ejemplo:
 *   npx tsx src/jobs/run.ts todos
 */

export interface ResultadoTrabajo {
  trabajo: string;
  afectados: number;
  detalle?: string;
}

/**
 * Materializa las metricas agregadas por campana.
 *
 * Es el unico camino por el que un patrocinador obtiene numeros: consulta esta
 * tabla precalculada, nunca la tabla de eventos. La supresion de cohortes
 * pequenas se aplica AQUI, al escribir, para que ni siquiera exista una fila con
 * un valor reidentificable esperando a que alguien la consulte.
 */
export async function materializarMetricasDeCampana(
  db: PrismaClient,
  dia: Date,
): Promise<ResultadoTrabajo> {
  const inicio = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate()));
  const fin = new Date(inicio.getTime() + 86_400_000);

  const campanas = await db.campaign.findMany({
    where: { active: true },
    select: { id: true, contentItems: { select: { id: true } }, rewards: { select: { id: true } } },
  });

  let escritas = 0;

  for (const campana of campanas) {
    const rewardIds = campana.rewards.map((r) => r.id);

    const canjes =
      rewardIds.length > 0
        ? await db.rewardRedemption.count({
            where: { rewardId: { in: rewardIds }, redeemedAt: { gte: inicio, lt: fin } },
          })
        : 0;

    const metricas: { clave: string; valor: number }[] = [
      { clave: 'campaign_reward_redemptions', valor: canjes },
      // Las vistas de contenido y las trivias se cuentan a partir de la tabla de
      // analitica agregada, que no tiene sujeto. En el MVP se dejan en cero
      // porque la web todavia no emite esos eventos al servidor.
      { clave: 'campaign_content_views', valor: 0 },
      { clave: 'campaign_quiz_completions', valor: 0 },
    ];

    for (const metrica of metricas) {
      const visible = suppressSmallCohort(metrica.valor);
      await db.campaignMetric.upsert({
        where: {
          campaignId_metricKey_bucketDate: {
            campaignId: campana.id,
            metricKey: metrica.clave,
            bucketDate: inicio,
          },
        },
        create: {
          campaignId: campana.id,
          metricKey: metrica.clave,
          bucketDate: inicio,
          value: metrica.valor,
          suppressed: visible == null,
        },
        update: { value: metrica.valor, suppressed: visible == null },
      });
      escritas += 1;
    }
  }

  return {
    trabajo: 'materializarMetricasDeCampana',
    afectados: escritas,
    detalle: `cohorte minima ${MIN_AGGREGATE_COHORT_SIZE}`,
  };
}

/** Agrega los eventos de verificacion del dia en conteos sin sujeto. */
export async function agregarAnaliticaDiaria(
  db: PrismaClient,
  dia: Date,
): Promise<ResultadoTrabajo> {
  const inicio = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate()));
  const fin = new Date(inicio.getTime() + 86_400_000);

  const grupos = await db.verificationEvent.groupBy({
    by: ['trustLevel', 'countryCode', 'method'],
    where: { createdAt: { gte: inicio, lt: fin } },
    _count: true,
  });

  let escritas = 0;
  for (const grupo of grupos) {
    // El evento que se persiste es el metodo de apertura, sin ningun
    // identificador de persona ni de dispositivo.
    const evento = grupo.method === 'QR_CODE' ? 'QR_OPENED' : 'NFC_OPENED';

    // Cadena vacia, no null: ver el comentario de AnalyticsDaily en el esquema.
    const clave = {
      bucketDate: inicio,
      event: evento,
      clubId: '',
      jerseyModelId: '',
      trustLevel: grupo.trustLevel,
      countryCode: grupo.countryCode ?? '',
    };

    await db.analyticsDaily.upsert({
      where: { bucketDate_event_clubId_jerseyModelId_trustLevel_countryCode: clave },
      create: { ...clave, count: grupo._count },
      update: { count: grupo._count },
    });
    escritas += 1;
  }

  return { trabajo: 'agregarAnaliticaDiaria', afectados: escritas };
}

/**
 * Aplica la politica de retencion.
 *
 * Borra el DETALLE TECNICO de los eventos de verificacion antiguos (seudonimo de
 * IP y huella de dispositivo) conservando la fila y su nivel de confianza: el
 * agregado sigue siendo util para estadistica, pero deja de poder vincularse a
 * una conexion concreta.
 */
export async function aplicarRetencion(db: PrismaClient): Promise<ResultadoTrabajo> {
  const dias = RETENTION_DAYS.verification_event_detail ?? 180;
  const corte = new Date(Date.now() - dias * 86_400_000);

  const resultado = await db.verificationEvent.updateMany({
    where: {
      createdAt: { lt: corte },
      OR: [{ ipPseudonym: { not: null } }, { deviceFingerprint: { not: null } }],
    },
    data: { ipPseudonym: null, deviceFingerprint: null, messageFingerprint: null },
  });

  return {
    trabajo: 'aplicarRetencion',
    afectados: resultado.count,
    detalle: `detalle tecnico anonimizado tras ${dias} dias`,
  };
}

/** Marca como caducadas las invitaciones de transferencia vencidas. */
export async function caducarTransferencias(db: PrismaClient): Promise<ResultadoTrabajo> {
  const resultado = await db.ownershipTransfer.updateMany({
    where: { state: 'PENDING', expiresAt: { lt: new Date() } },
    data: { state: 'EXPIRED' },
  });
  return { trabajo: 'caducarTransferencias', afectados: resultado.count };
}

/** Limpia sesiones y registros de idempotencia caducados. */
export async function limpiarCaducados(db: PrismaClient): Promise<ResultadoTrabajo> {
  const [sesiones, idempotencia] = await Promise.all([
    purgeExpiredSessions(db),
    purgeExpiredIdempotencyRecords(db),
  ]);
  return {
    trabajo: 'limpiarCaducados',
    afectados: sesiones + idempotencia,
    detalle: `${sesiones} sesiones, ${idempotencia} claves de idempotencia`,
  };
}

/**
 * Detecta lotes con una proporcion anomala de alertas y los marca.
 *
 * Marcar un lote NO declara falsas sus unidades: anade puntuacion de riesgo para
 * que las lecturas de ese lote reciban mas escrutinio y un humano lo revise.
 */
export async function marcarLotesAnomalos(
  db: PrismaClient,
  umbralProporcion = 0.1,
  minimoUnidades = 20,
): Promise<ResultadoTrabajo> {
  const lotes = await db.productionBatch.findMany({
    where: { flagged: false },
    select: { id: true, code: true, chips: { select: { id: true } } },
  });

  let marcados = 0;

  for (const lote of lotes) {
    if (lote.chips.length < minimoUnidades) continue;

    const conAlerta = await db.riskAlert.count({
      where: {
        state: { in: ['OPEN', 'IN_REVIEW', 'CONFIRMED'] },
        jerseyUnit: { emblem: { chip: { batchId: lote.id } } },
      },
    });

    const proporcion = conAlerta / lote.chips.length;
    if (proporcion < umbralProporcion) continue;

    await db.productionBatch.update({
      where: { id: lote.id },
      data: {
        flagged: true,
        flagReason:
          `Marcado automaticamente: ${conAlerta} alertas sobre ${lote.chips.length} chips ` +
          `(${Math.round(proporcion * 100)}%). Requiere revision humana.`,
      },
    });
    marcados += 1;
  }

  return { trabajo: 'marcarLotesAnomalos', afectados: marcados };
}

/** Ejecuta todos los trabajos en el orden adecuado. */
export async function ejecutarTodos(
  db: PrismaClient,
  dia = new Date(),
): Promise<ResultadoTrabajo[]> {
  return [
    await caducarTransferencias(db),
    await agregarAnaliticaDiaria(db, dia),
    await materializarMetricasDeCampana(db, dia),
    await marcarLotesAnomalos(db),
    await aplicarRetencion(db),
    await limpiarCaducados(db),
  ];
}
