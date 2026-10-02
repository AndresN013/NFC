'use client';

import { useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, type Column } from '@/components/DataTable';
import { Button, FilterBar, PageHeader, SearchFilter, SelectFilter } from '@/components/ui';
import { formatNumber, orDash } from '@/lib/format';
import type { ClubRow, Listed, PlayerRow } from '@/lib/types';

export default function JugadoresPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['catalog:read']}>
      <Jugadores />
    </GuardedPage>
  );
}

function Jugadores(): React.ReactElement {
  const [clubId, setClubId] = useState('');
  const [search, setSearch] = useState('');

  const clubs = useApiQuery<Listed<ClubRow>>('/admin/clubs');
  // `clubId` sí lo acepta el endpoint: se filtra en el servidor.
  const { data, error, loading, reload } = useApiQuery<Listed<PlayerRow>>('/admin/players', {
    clubId,
  });

  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !search) return items;
    const needle = search.toLowerCase();
    return items.filter(
      (player) =>
        player.fullName.toLowerCase().includes(needle) ||
        String(player.shirtNumber ?? '').includes(needle),
    );
  }, [data, search]);

  const clubName = (id: string): string =>
    clubs.data?.items.find((club) => club.id === id)?.name ?? '—';

  const columns: Column<PlayerRow>[] = [
    { key: 'name', header: 'Jugador', rowHeader: true, render: (row) => row.fullName },
    {
      key: 'number',
      header: 'Dorsal',
      numeric: true,
      render: (row) => orDash(row.shirtNumber),
    },
    { key: 'position', header: 'Posición', render: (row) => orDash(row.position) },
    { key: 'club', header: 'Club', render: (row) => clubName(row.clubId) },
  ];

  return (
    <>
      <PageHeader
        title="Jugadores"
        description="Plantilla activa por club. Alimenta el contenido dinámico del escudo."
      />

      <FilterBar>
        <SelectFilter
          label="Club"
          value={clubId}
          onChange={setClubId}
          allLabel="Todos los clubes"
          options={(clubs.data?.items ?? []).map((club) => ({ value: club.id, label: club.name }))}
        />
        <SearchFilter
          label="Buscar jugador o dorsal"
          value={search}
          placeholder="Mateo o 10"
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
        caption="Jugadores activos"
        captionDetail={`${formatNumber(rows?.length ?? 0)} jugador(es).`}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          search || clubId
            ? 'Ningún jugador coincide con los filtros.'
            : 'No hay jugadores registrados.'
        }
      />
    </>
  );
}
