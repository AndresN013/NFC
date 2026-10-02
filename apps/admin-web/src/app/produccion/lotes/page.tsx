'use client';

import { useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import {
  Button,
  Callout,
  FilterBar,
  PageHeader,
  SearchFilter,
  SelectFilter,
  StateTag,
} from '@/components/ui';
import { formatDateTime, formatNumber, orDash, truncate } from '@/lib/format';
import type { BatchRow, Listed } from '@/lib/types';

export default function LotesPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['production:read']}>
      <Lotes />
    </GuardedPage>
  );
}

function Lotes(): React.ReactElement {
  const { data, error, loading, reload } = useApiQuery<Listed<BatchRow>>('/admin/batches');
  const [flagged, setFlagged] = useState('');
  const [search, setSearch] = useState('');

  // `GET /admin/batches` devuelve la lista completa: los filtros son del cliente.
  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items) return null;
    const needle = search.toLowerCase();
    return items.filter((batch) => {
      if (flagged === 'si' && !batch.flagged) return false;
      if (flagged === 'no' && batch.flagged) return false;
      if (!needle) return true;
      return (
        batch.code.toLowerCase().includes(needle) ||
        (batch.supplierName ?? '').toLowerCase().includes(needle) ||
        (batch.supplierLotRef ?? '').toLowerCase().includes(needle)
      );
    });
  }, [data, flagged, search]);

  const flaggedCount = (data?.items ?? []).filter((batch) => batch.flagged).length;

  const columns: Column<BatchRow>[] = [
    { key: 'code', header: 'Lote', rowHeader: true, render: (row) => <Mono>{row.code}</Mono> },
    {
      key: 'flagged',
      header: 'Calidad',
      render: (row) => (
        <StateTag
          descriptor={
            row.flagged
              ? { label: 'Marcado', symbol: '⚠', tone: 'aviso' }
              : { label: 'Sin incidencias', symbol: '✓', tone: 'positivo' }
          }
        />
      ),
    },
    {
      key: 'flagReason',
      header: 'Motivo de la marca',
      render: (row) => orDash(row.flagReason ? truncate(row.flagReason, 70) : null),
    },
    { key: 'supplier', header: 'Proveedor', render: (row) => orDash(row.supplierName) },
    {
      key: 'supplierLotRef',
      header: 'Ref. del proveedor',
      render: (row) => (row.supplierLotRef ? <Mono>{row.supplierLotRef}</Mono> : '—'),
    },
    { key: 'chips', header: 'Chips', numeric: true, render: (row) => formatNumber(row._count.chips) },
    {
      key: 'emblems',
      header: 'Emblemas',
      numeric: true,
      render: (row) => formatNumber(row._count.emblems),
    },
    { key: 'receivedAt', header: 'Recibido', render: (row) => formatDateTime(row.receivedAt) },
  ];

  return (
    <>
      <PageHeader
        title="Lotes de producción"
        description="Lotes de chips recibidos del proveedor y su estado de control de calidad."
      />

      {flaggedCount > 0 ? (
        <Callout variant="aviso" title={`${flaggedCount} lote(s) marcado(s) por calidad`}>
          <p>
            Un lote marcado indica una anomalía detectada en la recepción. Las unidades que lo usan
            suelen acabar en cuarentena hasta que alguien decida.
          </p>
        </Callout>
      ) : null}

      <FilterBar>
        <SelectFilter
          label="Marcado por calidad"
          value={flagged}
          onChange={setFlagged}
          allLabel="Todos"
          options={[
            { value: 'si', label: 'Solo marcados' },
            { value: 'no', label: 'Solo sin incidencias' },
          ]}
        />
        <SearchFilter
          label="Buscar lote o proveedor"
          value={search}
          placeholder="LOTE-NTAG213-A"
          onSubmit={setSearch}
        />
        {search || flagged ? (
          <Button
            variant="discreto"
            onClick={() => {
              setSearch('');
              setFlagged('');
            }}
          >
            Limpiar filtros
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Lotes de chips"
        captionDetail={`${formatNumber(rows?.length ?? 0)} de ${formatNumber(
          data?.items.length ?? 0,
        )} lotes.`}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          search || flagged ? 'Ningún lote coincide con los filtros.' : 'No hay lotes registrados.'
        }
      />
    </>
  );
}
