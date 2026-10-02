'use client';

import { useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import { Button, FilterBar, PageHeader, SearchFilter } from '@/components/ui';
import { formatDate, formatNumber, orDash } from '@/lib/format';
import type { ClubRow, Listed } from '@/lib/types';

export default function ClubesPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['catalog:read']}>
      <Clubes />
    </GuardedPage>
  );
}

function Clubes(): React.ReactElement {
  const { data, error, loading, reload } = useApiQuery<Listed<ClubRow>>('/admin/clubs');
  const [search, setSearch] = useState('');

  // `GET /admin/clubs` no acepta búsqueda: se filtra en el cliente sobre la
  // lista completa, que es corta por diseño (un club por equipo).
  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !search) return items;
    const needle = search.toLowerCase();
    return items.filter(
      (club) =>
        club.name.toLowerCase().includes(needle) || club.slug.toLowerCase().includes(needle),
    );
  }, [data, search]);

  const columns: Column<ClubRow>[] = [
    { key: 'name', header: 'Club', rowHeader: true, render: (row) => row.name },
    { key: 'slug', header: 'Identificador', render: (row) => <Mono>{row.slug}</Mono> },
    {
      key: 'seasons',
      header: 'Temporadas',
      render: (row) =>
        row.seasons.length === 0 ? (
          'Sin temporadas'
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {row.seasons.map((season) => (
              <li key={season.id}>
                {season.name} ({formatDate(season.startDate)} – {formatDate(season.endDate)})
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'models',
      header: 'Modelos',
      numeric: true,
      render: (row) => formatNumber(row._count.jerseyModels),
    },
    {
      key: 'players',
      header: 'Jugadores',
      numeric: true,
      render: (row) => formatNumber(row._count.players),
    },
    {
      key: 'colors',
      header: 'Colores',
      render: (row) => (
        // El color de marca se muestra como texto: un cuadro de color no es
        // legible para quien no lo distingue.
        <Mono>
          {orDash(row.primaryColor)} / {orDash(row.secondaryColor)}
        </Mono>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Clubes" description="Clubes del catálogo con sus temporadas registradas." />

      <FilterBar>
        <SearchFilter
          label="Buscar club"
          value={search}
          placeholder="Deportivo Andino"
          onSubmit={setSearch}
        />
        {search ? (
          <Button variant="discreto" onClick={() => setSearch('')}>
            Quitar búsqueda
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Clubes del catálogo"
        captionDetail={
          search
            ? `Filtrado por «${search}» sobre ${formatNumber(data?.items.length ?? 0)} clubes.`
            : undefined
        }
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          search ? 'Ningún club coincide con la búsqueda.' : 'No hay clubes en el catálogo.'
        }
      />
    </>
  );
}
