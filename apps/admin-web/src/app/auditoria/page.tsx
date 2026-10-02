'use client';

import { useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import {
  Button,
  Callout,
  FilterBar,
  PageHeader,
  Pagination,
  SearchFilter,
  SelectFilter,
} from '@/components/ui';
import { formatDateTime, orDash, truncate } from '@/lib/format';
import type { AuditRow, Paged } from '@/lib/types';

const PAGE_SIZE = 50;

/** Entidades que la API audita. Se ofrecen como filtro rápido. */
const ENTITY_TYPES = [
  'User',
  'JerseyUnit',
  'NfcChip',
  'ProductionOrder',
  'ProductionBatch',
  'AuthorizedDevice',
  'RiskAlert',
  'SupportCase',
  'PrivacyRequest',
  'Ownership',
  'ContentItem',
];

export default function AuditoriaPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['audit:read']}>
      <Auditoria />
    </GuardedPage>
  );
}

function Auditoria(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');

  const filters = { action, entityType };

  const { data, error, loading, reload } = useApiQuery<Paged<AuditRow>>('/admin/audit', {
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });

  const columns: Column<AuditRow>[] = [
    {
      key: 'createdAt',
      header: 'Cuándo',
      rowHeader: true,
      render: (row) => formatDateTime(row.createdAt),
    },
    { key: 'actor', header: 'Quién', render: (row) => <Mono>{orDash(row.actor)}</Mono> },
    { key: 'action', header: 'Acción', render: (row) => <Mono>{row.action}</Mono> },
    { key: 'entityType', header: 'Entidad', render: (row) => orDash(row.entityType) },
    {
      key: 'entityId',
      header: 'Identificador',
      render: (row) => (row.entityId ? <Mono>{row.entityId}</Mono> : '—'),
    },
    {
      key: 'ipPrefix',
      header: 'Prefijo de IP',
      render: (row) => (row.ipPrefix ? <Mono>{row.ipPrefix}</Mono> : '—'),
    },
    {
      key: 'metadata',
      header: 'Detalle',
      render: (row) => <Mono>{truncate(row.metadata, 90)}</Mono>,
    },
  ];

  const hasFilters = Boolean(action || entityType);

  return (
    <>
      <PageHeader
        title="Registro de auditoría"
        description="Quién hizo qué y cuándo. Es el registro que permite reconstruir una decisión meses después."
      />

      <Callout variant="info" title="Sólo se guarda el prefijo de la IP">
        <p>
          La API registra el prefijo de red (por ejemplo <Mono>127.0.0.0</Mono>), no la dirección
          completa: basta para investigar un patrón sin convertir el registro en un historial de
          ubicaciones. Los cuerpos de las peticiones y las cabeceras de autorización nunca se anotan.
        </p>
      </Callout>

      <FilterBar>
        <SearchFilter
          label="Buscar por acción"
          value={action}
          placeholder="admin.unit.revoked"
          onSubmit={(value) => {
            setAction(value);
            setPage(1);
          }}
        />
        <SelectFilter
          label="Entidad"
          value={entityType}
          onChange={(value) => {
            setEntityType(value);
            setPage(1);
          }}
          allLabel="Todas las entidades"
          options={ENTITY_TYPES.map((value) => ({ value, label: value }))}
        />
        {hasFilters ? (
          <Button
            variant="discreto"
            onClick={() => {
              setAction('');
              setEntityType('');
              setPage(1);
            }}
          >
            Limpiar filtros
          </Button>
        ) : null}
        {/* Exporta el conjunto filtrado completo, no la página visible. */}
        <ExportCsvButton path="/admin/audit" query={filters} fallbackName="auditoria.csv" />
      </FilterBar>

      <DataTable
        caption="Eventos de auditoría"
        captionDetail={
          hasFilters
            ? 'Resultados filtrados. La exportación CSV usa estos mismos filtros.'
            : 'Del evento más reciente al más antiguo.'
        }
        columns={columns}
        rows={data?.items ?? null}
        getRowKey={(row, index) => `${row.createdAt}-${row.action}-${index}`}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          hasFilters
            ? 'Ningún evento coincide con los filtros.'
            : 'El registro de auditoría está vacío.'
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
