'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
  SUPPORT_CASE_REASON_COPY,
  SUPPORT_CASE_STATES,
} from '@mev/domain/browser';
import { formatDateTime, orDash, supportStateLabel, truncate } from '@/lib/format';
import type { Paged, SupportCaseRow } from '@/lib/types';

const PAGE_SIZE = 25;
// Estados y motivos vienen del dominio, no se redeclaran aquí: cuando esta
// página los declaraba por su cuenta mostraba valores que la API nunca emite.
const SUPPORT_STATES = [...SUPPORT_CASE_STATES];
const REASON_LABELS: Record<string, string> = SUPPORT_CASE_REASON_COPY;

export default function CasosPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['support:read']}>
      <Casos />
    </GuardedPage>
  );
}

function Casos(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');

  const { data, error, loading, reload } = useApiQuery<Paged<SupportCaseRow>>(
    '/admin/support-cases',
    { page, pageSize: PAGE_SIZE, state },
  );

  // Los estados posibles se toman del enum conocido, más los que traiga la API.
  const states = useMemo(() => {
    const seen = new Set<string>(SUPPORT_STATES);
    for (const item of data?.items ?? []) seen.add(item.state);
    return [...seen];
  }, [data]);

  const columns: Column<SupportCaseRow>[] = [
    {
      key: 'subject',
      header: 'Asunto',
      rowHeader: true,
      // El asunto es el enlace al detalle: es donde el caso se resuelve.
      render: (row) => <Link href={`/soporte/casos/${row.id}`}>{row.subject}</Link>,
    },
    {
      key: 'state',
      header: 'Estado',
      render: (row) => (
        <StateTag
          descriptor={{
            label: supportStateLabel(row.state),
            symbol:
              row.state === 'RESOLVED' || row.state === 'CLOSED'
                ? '✓'
                : row.state === 'OPEN'
                  ? '●'
                  : '⟳',
            tone: row.state === 'RESOLVED' || row.state === 'CLOSED' ? 'positivo' : 'aviso',
          }}
        />
      ),
    },
    {
      key: 'reason',
      header: 'Motivo',
      render: (row) => REASON_LABELS[row.reason] ?? row.reason,
    },
    {
      key: 'unit',
      header: 'Unidad',
      render: (row) => (row.jerseyUnit ? <Mono>{row.jerseyUnit.publicRef}</Mono> : '—'),
    },
    {
      key: 'contact',
      header: 'Contacto',
      render: (row) => (row.contactEmail ? <Mono>{row.contactEmail}</Mono> : '—'),
    },
    {
      key: 'description',
      header: 'Descripción',
      render: (row) => orDash(row.description ? truncate(row.description, 90) : null),
    },
    { key: 'createdAt', header: 'Abierto', render: (row) => formatDateTime(row.createdAt) },
    { key: 'resolvedAt', header: 'Resuelto', render: (row) => formatDateTime(row.resolvedAt) },
  ];

  return (
    <>
      <PageHeader
        title="Casos de soporte"
        description="Casos abiertos por aficionados sobre sus jerseys."
      />

      <Callout variant="aviso" title="Esta pantalla contiene datos personales">
        <p>
          El correo de contacto del aficionado es un dato personal y está aquí sólo para poder
          atender el caso. No lo copie a herramientas externas ni lo comparta con clubes,
          proveedores o patrocinadores.
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
          options={states.map((value) => ({ value, label: supportStateLabel(value) }))}
        />
        {state ? (
          <Button
            variant="discreto"
            onClick={() => {
              setState('');
              setPage(1);
            }}
          >
            Quitar filtro
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Casos de soporte"
        captionDetail="Ordenados del más reciente al más antiguo."
        columns={columns}
        rows={data?.items ?? null}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          state ? 'Ningún caso en ese estado.' : 'No hay casos de soporte registrados.'
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
