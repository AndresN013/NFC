'use client';

import { useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import { Button, FilterBar, PageHeader, SearchFilter, SelectFilter } from '@/components/ui';
import { formatNumber, formatPriceCents, orDash, truncate } from '@/lib/format';
import type { ClubRow, JerseyModelRow, Listed } from '@/lib/types';

export default function ModelosPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['catalog:read']}>
      <Modelos />
    </GuardedPage>
  );
}

function Modelos(): React.ReactElement {
  const { data, error, loading, reload } = useApiQuery<Listed<JerseyModelRow>>(
    '/admin/jersey-models',
  );
  const clubs = useApiQuery<Listed<ClubRow>>('/admin/clubs');

  const [search, setSearch] = useState('');
  const [clubId, setClubId] = useState('');

  // El endpoint devuelve la lista completa sin filtros; se filtra en el cliente.
  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items) return null;
    const needle = search.toLowerCase();
    return items.filter((model) => {
      if (clubId && model.clubId !== clubId) return false;
      if (!needle) return true;
      return (
        model.name.toLowerCase().includes(needle) ||
        model.edition.toLowerCase().includes(needle) ||
        model.skus.some((sku) => sku.code.toLowerCase().includes(needle))
      );
    });
  }, [data, search, clubId]);

  const columns: Column<JerseyModelRow>[] = [
    { key: 'name', header: 'Modelo', rowHeader: true, render: (row) => row.name },
    { key: 'club', header: 'Club', render: (row) => row.club.name },
    { key: 'season', header: 'Temporada', render: (row) => row.season.name },
    { key: 'edition', header: 'Edición', render: (row) => row.edition },
    {
      key: 'skus',
      header: 'Referencias y tallas',
      render: (row) =>
        row.skus.length === 0 ? (
          'Sin referencias'
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {row.skus.map((sku) => (
              <li key={sku.id}>
                <Mono>{sku.code}</Mono> · talla {sku.size} · {formatPriceCents(sku.priceCents)}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'units',
      header: 'Unidades',
      numeric: true,
      render: (row) => formatNumber(row._count.units),
    },
    {
      key: 'description',
      header: 'Descripción',
      render: (row) => orDash(row.description ? truncate(row.description, 70) : null),
    },
  ];

  return (
    <>
      <PageHeader
        title="Modelos de jersey"
        description="Modelos por club y temporada, con sus referencias comerciales."
      />

      <FilterBar>
        <SelectFilter
          label="Club"
          value={clubId}
          onChange={setClubId}
          allLabel="Todos los clubes"
          options={(clubs.data?.items ?? []).map((club) => ({
            value: club.id,
            label: club.name,
          }))}
        />
        <SearchFilter
          label="Buscar modelo o referencia"
          value={search}
          placeholder="Local 2026 o AND-HOME-26-M"
          onSubmit={setSearch}
        />
        {search || clubId ? (
          <Button
            variant="discreto"
            onClick={() => {
              setSearch('');
              setClubId('');
            }}
          >
            Limpiar filtros
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Modelos de jersey del catálogo"
        captionDetail={`${formatNumber(rows?.length ?? 0)} de ${formatNumber(
          data?.items.length ?? 0,
        )} modelos.`}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          search || clubId
            ? 'Ningún modelo coincide con los filtros.'
            : 'No hay modelos en el catálogo.'
        }
      />
    </>
  );
}
