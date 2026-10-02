'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { MIN_AGGREGATE_COHORT_SIZE } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import { Callout, DefinitionList, PageHeader, StateTag } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/format';
import type { CampaignMetricsResponse } from '@/lib/types';

/**
 * Vista de patrocinador.
 *
 * ============================================================================
 * REGLA DE PRIVACIDAD NO NEGOCIABLE
 * ============================================================================
 * Esta pantalla NO muestra jamas datos personales de aficionados: ni correos,
 * ni nombres, ni identificadores de persona, ni filas individuales. Solo
 * conteos agregados de SU campana.
 *
 * Como se garantiza:
 *  - la unica llamada que hace es `GET /admin/analytics/campaign/:id`, que
 *    devuelve contadores materializados (`metricKey`, `date`, `value`) y nada mas;
 *  - no se importa ningun otro endpoint ni se enlaza a otra seccion del panel;
 *  - los valores con cohorte inferior al minimo llegan como `null` y se pintan
 *    como "suprimido", explicando el motivo;
 *  - el rol SPONSOR no tiene `fans:read`, `ownership:read` ni `analytics:read`,
 *    asi que el servidor rechazaria cualquier intento de pedir mas.
 *
 * Si alguien anade aqui una tabla de filas por persona, esta rompiendo la regla.
 */

const METRIC_LABELS: Record<string, string> = {
  campaign_reward_redemptions: 'Canjes de recompensas',
  campaign_content_views: 'Vistas de contenido patrocinado',
  campaign_quiz_completions: 'Trivias completadas',
};

function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

interface MetricPoint {
  metricKey: string;
  date: string;
  value: number | null;
}

export default function CampanaPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['analytics:campaign_scoped']}>
      <Campana />
    </GuardedPage>
  );
}

function Campana(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const campaignId = typeof params.id === 'string' ? params.id : '';

  const { data, error, loading, reload } = useApiQuery<CampaignMetricsResponse>(
    campaignId ? `/admin/analytics/campaign/${campaignId}` : null,
  );

  const minCohort = data?.minCohortSize ?? MIN_AGGREGATE_COHORT_SIZE;

  // Agrupado por metrica para que cada tabla tenga una sola unidad de medida.
  const groups = useMemo(() => {
    const map = new Map<string, MetricPoint[]>();
    for (const point of data?.metrics ?? []) {
      const list = map.get(point.metricKey) ?? [];
      list.push(point);
      map.set(point.metricKey, list);
    }
    return [...map.entries()].map(([metricKey, points]) => ({
      metricKey,
      points: [...points].sort((a, b) => a.date.localeCompare(b.date)),
      suppressed: points.filter((point) => point.value === null).length,
      // El total sólo suma lo publicable: sumar suprimidos daría un número falso.
      visibleTotal: points.reduce((sum, point) => sum + (point.value ?? 0), 0),
    }));
  }, [data]);

  const columns: Column<MetricPoint>[] = [
    { key: 'date', header: 'Fecha', rowHeader: true, render: (row) => formatDate(row.date) },
    {
      key: 'value',
      header: 'Valor',
      numeric: true,
      render: (row) =>
        row.value === null ? (
          // Nunca se muestra 0 ni se deja la celda vacía: eso se leería como
          // "no pasó nada". Se dice que el dato existe y está suprimido.
          <StateTag descriptor={{ label: 'Suprimido', symbol: '⃠', tone: 'aviso' }} />
        ) : (
          formatNumber(row.value)
        ),
    },
  ];

  const totalSuppressed = groups.reduce((sum, group) => sum + group.suppressed, 0);

  return (
    <>
      <PageHeader
        title="Métricas de su campaña"
        description="Sólo conteos agregados. Esta vista no contiene ni puede contener datos de aficionados concretos."
      />

      <Callout variant="info" title="Qué se muestra y qué no">
        <p>
          Se muestran <strong>únicamente contadores agregados</strong> de su campaña, calculados por
          adelantado. No hay acceso a nombres, correos, identificadores de persona ni filas
          individuales: esa información no viaja hasta esta pantalla.
        </p>
        <DefinitionList
          items={[
            { term: 'Campaña', value: <Mono>{campaignId}</Mono> },
            {
              term: 'Cohorte mínima',
              value: `${minCohort} personas`,
            },
          ]}
        />
      </Callout>

      <Callout variant="aviso" title="Por qué algunos valores aparecen como «suprimido»">
        <p>
          Un agregado calculado sobre muy pocas personas deja de ser un agregado: con dos o tres
          sujetos, el número señala a individuos concretos. Por eso todo valor cuya cohorte sea
          inferior a <strong>{minCohort} personas</strong> se publica como{' '}
          <StateTag descriptor={{ label: 'Suprimido', symbol: '⃠', tone: 'aviso' }} /> en lugar de
          mostrarse.
        </p>
        <p>
          «Suprimido» <strong>no significa cero</strong>: significa que hubo actividad pero es
          demasiado escasa para publicarla sin arriesgar la reidentificación de una persona. Tampoco
          se puede deducir el valor restando totales, porque los totales sólo suman lo publicable.
        </p>
        {data?.note ? <p>{data.note}</p> : null}
      </Callout>

      <div aria-live="polite">
        {loading && !data ? <p role="status">Cargando métricas de la campaña…</p> : null}
        {error ? (
          <Callout variant="peligro" title="No se pudieron cargar las métricas">
            <p>{error.message}</p>
            {error.isForbidden ? (
              <p>
                Su cuenta sólo puede consultar las métricas de la campaña sobre la que tiene alcance.
                Si ha llegado aquí desde un enlace, compruebe que corresponde a su campaña.
              </p>
            ) : null}
            <button type="button" onClick={reload}>
              Reintentar
            </button>
          </Callout>
        ) : null}
      </div>

      {data && groups.length === 0 && !loading ? (
        <Callout variant="info" title="Todavía no hay métricas publicables">
          <p>
            La campaña no tiene contadores agregados disponibles. Puede deberse a que aún no hay
            actividad o a que toda la que hay queda por debajo de la cohorte mínima.
          </p>
        </Callout>
      ) : null}

      {totalSuppressed > 0 ? (
        <p role="status">
          {totalSuppressed} valor(es) de esta página están suprimidos por cohorte pequeña.
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.metricKey} style={{ marginBottom: 'calc(var(--espacio) * 4)' }}>
          <h2>{metricLabel(group.metricKey)}</h2>
          <DataTable
            caption={`${metricLabel(group.metricKey)} por día`}
            captionDetail={
              <>
                Total publicable: {formatNumber(group.visibleTotal)}.{' '}
                {group.suppressed > 0
                  ? `${group.suppressed} día(s) suprimido(s) por cohorte inferior a ${minCohort} personas; no están incluidos en el total.`
                  : 'Ningún día quedó suprimido.'}
              </>
            }
            columns={columns}
            rows={group.points}
            getRowKey={(row) => `${row.metricKey}-${row.date}`}
            loading={loading}
            emptyMessage="Sin valores para esta métrica."
          />
        </section>
      ))}
    </>
  );
}
