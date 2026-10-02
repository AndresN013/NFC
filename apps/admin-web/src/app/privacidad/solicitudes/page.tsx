'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PRIVACY_REQUEST_STATES, PRIVACY_REQUEST_TYPES } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import {
  Button,
  Callout,
  FilterBar,
  PageHeader,
  Pagination,
  SelectFilter,
  StateTag,
} from '@/components/ui';
import {
  describeDue,
  formatDate,
  formatDateTime,
  orDash,
  PRIVACY_SLA_DAYS,
  privacyStateLabel,
  privacyTypeLabel,
  truncate,
} from '@/lib/format';
import type { Paged, PrivacyRequestRow } from '@/lib/types';

const PAGE_SIZE = 25;

export default function SolicitudesPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['privacy:read']}>
      <Solicitudes />
    </GuardedPage>
  );
}

function Solicitudes(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [type, setType] = useState('');

  // La API filtra por estado; el tipo se filtra en el cliente porque el
  // endpoint no lo acepta.
  const { data, error, loading, reload } = useApiQuery<Paged<PrivacyRequestRow>>(
    '/admin/privacy-requests',
    { page, pageSize: PAGE_SIZE, state },
  );

  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !type) return items;
    return items.filter((item) => item.type === type);
  }, [data, type]);

  const overdue = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) => describeDue(item.dueAt, { resolvedAt: item.resolvedAt }).overdue,
      ).length,
    [data],
  );

  const columns: Column<PrivacyRequestRow>[] = [
    {
      key: 'type',
      header: 'Tipo de solicitud',
      rowHeader: true,
      // Enlace al detalle: es donde la solicitud se resuelve y donde se ejecuta
      // la eliminacion cuando corresponde.
      render: (row) => (
        <Link href={`/privacidad/solicitudes/${row.id}`}>{privacyTypeLabel(row.type)}</Link>
      ),
    },
    {
      key: 'state',
      header: 'Estado',
      render: (row) => (
        <StateTag
          descriptor={{
            label: privacyStateLabel(row.state),
            symbol: row.state === 'COMPLETED' ? '✓' : row.state === 'REJECTED' ? '✕' : '⟳',
            tone:
              row.state === 'COMPLETED'
                ? 'positivo'
                : row.state === 'REJECTED'
                  ? 'peligro'
                  : 'neutro',
          }}
        />
      ),
    },
    {
      key: 'due',
      header: 'Plazo de atención',
      render: (row) => {
        const due = describeDue(row.dueAt, { resolvedAt: row.resolvedAt });
        return (
          <>
            {/* Una solicitud vencida se marca con texto y símbolo, no sólo en rojo. */}
            <StateTag
              descriptor={{
                label: due.label,
                symbol: due.overdue ? '▲' : due.label === 'Atendida' ? '✓' : '⏱',
                tone: due.overdue ? 'peligro' : due.daysLeft <= 3 ? 'aviso' : 'neutro',
              }}
            />
            <br />
            <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
              Vence el {formatDate(row.dueAt)}
            </span>
          </>
        );
      },
    },
    {
      key: 'email',
      header: 'Solicitante',
      render: (row) => (row.email ? <Mono>{row.email}</Mono> : '—'),
    },
    {
      key: 'details',
      header: 'Detalle',
      render: (row) => orDash(row.details ? truncate(row.details, 80) : null),
    },
    { key: 'createdAt', header: 'Recibida', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'resolution',
      header: 'Resolución',
      render: (row) =>
        row.resolvedAt ? (
          <>
            {formatDateTime(row.resolvedAt)}
            <br />
            <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
              {orDash(row.resolution ? truncate(row.resolution, 60) : null)}
            </span>
          </>
        ) : (
          'Pendiente'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Solicitudes de privacidad"
        description={`Derechos ejercidos por aficionados. El plazo comprometido es de ${PRIVACY_SLA_DAYS} días naturales desde la recepción.`}
      />

      {overdue > 0 ? (
        <Callout
          variant="peligro"
          title={`${overdue} solicitud(es) fuera de plazo en esta página`}
        >
          <p>
            Una solicitud vencida es un incumplimiento frente a la persona que la presentó, no un
            simple retraso interno. Atiéndalas antes que el resto de la cola.
          </p>
        </Callout>
      ) : null}

      <Callout variant="aviso" title="Esta pantalla contiene datos personales">
        <p>
          El correo del solicitante aparece porque es imprescindible para responderle. No lo use para
          ningún otro fin ni lo exporte fuera del panel.
        </p>
      </Callout>

      <FilterBar>
        <SelectFilter
          label="Estado"
          value={state}
          onChange={(value) => {
            setState(value);
            setPage(1);
          }}
          allLabel="Todos los estados"
          options={PRIVACY_REQUEST_STATES.map((value) => ({
            value,
            label: privacyStateLabel(value),
          }))}
        />
        <SelectFilter
          label="Tipo"
          value={type}
          onChange={setType}
          allLabel="Todos los tipos"
          options={PRIVACY_REQUEST_TYPES.map((value) => ({ value, label: privacyTypeLabel(value) }))}
        />
        {state || type ? (
          <Button
            variant="discreto"
            onClick={() => {
              setState('');
              setType('');
              setPage(1);
            }}
          >
            Limpiar filtros
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Solicitudes de privacidad"
        captionDetail="Ordenadas por fecha de vencimiento: primero las más urgentes."
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          state || type
            ? 'Ninguna solicitud coincide con los filtros.'
            : 'No hay solicitudes de privacidad pendientes.'
        }
      />

      {data ? (
        <Pagination
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          onPageChange={setPage}
        />
      ) : null}
    </>
  );
}
