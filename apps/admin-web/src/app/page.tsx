'use client';

import Link from 'next/link';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { useSession } from '@/components/SessionProvider';
import { DataTable, type Column } from '@/components/DataTable';
import { Callout, MetricGrid, PageHeader, StateTag } from '@/components/ui';
import {
  describeUnitState,
  formatNumber,
  trustLevelLabel,
  verificationMethodLabel,
} from '@/lib/format';
import { hasUiPermission, scopedCampaignIds } from '@/lib/permissions';
import type { OverviewResponse } from '@/lib/types';

interface CountRow {
  key: string;
  label: string;
  count: number;
}

export default function InicioPage(): React.ReactElement {
  const { session, permissions } = useSession();

  // Un patrocinador no tiene `analytics:read`: su inicio es su campana, no el
  // panel general. Se le ofrece el enlace en vez de un aviso de "sin permiso".
  if (
    session &&
    !hasUiPermission(permissions, 'analytics:read') &&
    hasUiPermission(permissions, 'analytics:campaign_scoped')
  ) {
    const campaigns = scopedCampaignIds(session.roles);
    return (
      <>
        <PageHeader
          title={`Hola, ${session.user.displayName}`}
          description="Su cuenta tiene acceso únicamente a las métricas agregadas de su campaña."
        />
        {campaigns.length > 0 ? (
          <Callout variant="info" title="Su campaña">
            <p>
              <Link href={`/patrocinador/campana/${campaigns[0]}`}>
                Ver las métricas agregadas de mi campaña
              </Link>
            </p>
          </Callout>
        ) : (
          <Callout variant="aviso" title="Sin campaña asignada">
            <p>No hay ninguna campaña asociada a su cuenta. Contacte con su responsable.</p>
          </Callout>
        )}
      </>
    );
  }

  return (
    <GuardedPage permissions={['analytics:read']}>
      <Resumen />
    </GuardedPage>
  );
}

function Resumen(): React.ReactElement {
  const { data, error, loading, reload } = useApiQuery<OverviewResponse>('/admin/analytics/overview');

  const trustRows: CountRow[] = Object.entries(data?.verificationsByTrustLevel ?? {})
    .map(([key, count]) => ({ key, label: trustLevelLabel(key), count }))
    .sort((a, b) => b.count - a.count);

  const methodRows: CountRow[] = Object.entries(data?.verificationsByMethod ?? {})
    .map(([key, count]) => ({ key, label: verificationMethodLabel(key), count }))
    .sort((a, b) => b.count - a.count);

  const countColumns = (header: string): Column<CountRow>[] => [
    { key: 'label', header, render: (row) => row.label, rowHeader: true },
    { key: 'count', header: 'Verificaciones', numeric: true, render: (row) => formatNumber(row.count) },
  ];

  // Los estados que la API no desglosa se agrupan en "otros" para que la suma cuadre.
  const otros = data
    ? Math.max(0, data.units.total - data.units.activated - data.units.sold - data.units.quarantined)
    : 0;

  return (
    <>
      <PageHeader
        title="Resumen de operación"
        description={
          data
            ? `Verificaciones de los últimos ${data.windowDays} días. Unidades y alertas a día de hoy.`
            : 'Métricas generales de producción, verificación y riesgo.'
        }
      />

      <div aria-live="polite">
        {error ? (
          <Callout variant="peligro" title="No se pudo cargar el resumen">
            <p>{error.message}</p>
            <button type="button" onClick={reload}>
              Reintentar
            </button>
          </Callout>
        ) : null}
        {loading && !data ? <p role="status">Cargando métricas…</p> : null}
      </div>

      {data ? (
        <>
          <h2>Unidades por estado</h2>
          <MetricGrid
            label="Unidades por estado"
            items={[
              { label: 'Unidades registradas', value: formatNumber(data.units.total) },
              { label: 'Activadas', value: formatNumber(data.units.activated) },
              { label: 'Vendidas', value: formatNumber(data.units.sold) },
              { label: 'En cuarentena', value: formatNumber(data.units.quarantined) },
              {
                label: 'Otros estados',
                value: formatNumber(otros),
                detail: 'Planificadas, en producción, listas o revocadas',
              },
            ]}
          />

          <h2>Chips y alertas</h2>
          <MetricGrid
            label="Chips y alertas"
            items={[
              { label: 'Chips registrados', value: formatNumber(data.chips.total) },
              {
                label: 'Alertas abiertas',
                value: formatNumber(data.alerts.open),
                detail: 'Pendientes de revisión humana',
              },
            ]}
          />

          {data.alerts.open > 0 ? (
            <Callout variant="aviso" title={`Hay ${data.alerts.open} alerta(s) abierta(s)`}>
              <p>
                Las alertas abiertas esperan revisión humana.{' '}
                <Link href="/riesgo/alertas?state=OPEN">Ir a la cola de alertas</Link>.
              </p>
            </Callout>
          ) : null}

          <h2>Cuarentena</h2>
          <p>
            Estado de las unidades retenidas:{' '}
            <StateTag descriptor={describeUnitState('QUARANTINED')} /> —{' '}
            {formatNumber(data.units.quarantined)} unidad(es).
          </p>

          <h2 id="por-confianza">Verificaciones por nivel de confianza</h2>
          <DataTable
            caption="Verificaciones por nivel de confianza"
            captionDetail={`Ventana de ${data.windowDays} días.`}
            columns={countColumns('Nivel de confianza')}
            rows={trustRows}
            getRowKey={(row) => row.key}
            loading={loading}
            emptyMessage="No hubo verificaciones en la ventana consultada."
          />

          <h2 id="por-metodo" style={{ marginTop: 'calc(var(--espacio) * 4)' }}>
            Verificaciones por método
          </h2>
          <DataTable
            caption="Verificaciones por método de lectura"
            captionDetail={`Ventana de ${data.windowDays} días.`}
            columns={countColumns('Método')}
            rows={methodRows}
            getRowKey={(row) => row.key}
            loading={loading}
            emptyMessage="No hubo verificaciones en la ventana consultada."
          />
        </>
      ) : null}
    </>
  );
}
