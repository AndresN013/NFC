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
import { formatDate, formatNumber, orDash, pickLocalized, truncate } from '@/lib/format';
import type { ContentRow, Listed } from '@/lib/types';

const KIND_LABELS: Record<string, string> = {
  HERO: 'Cabecera',
  MATCH_CARD: 'Ficha de partido',
  PLAYER_CARD: 'Ficha de jugador',
  VIDEO: 'Vídeo',
  REWARD: 'Recompensa',
  SPONSOR: 'Patrocinio',
  ANNOUNCEMENT: 'Anuncio',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export default function ContenidoPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['content:read']}>
      <Contenido />
    </GuardedPage>
  );
}

function Contenido(): React.ReactElement {
  const { data, error, loading, reload } = useApiQuery<Listed<ContentRow>>('/admin/content');
  const [kind, setKind] = useState('');
  const [activeOnly, setActiveOnly] = useState('');
  const [search, setSearch] = useState('');

  // `GET /admin/content` no acepta filtros: se filtra en el cliente.
  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items) return null;
    const needle = search.toLowerCase();
    return items.filter((item) => {
      if (kind && item.kind !== kind) return false;
      if (activeOnly === 'si' && !item.active) return false;
      if (activeOnly === 'no' && item.active) return false;
      if (!needle) return true;
      return (
        pickLocalized(item.title).toLowerCase().includes(needle) ||
        pickLocalized(item.body).toLowerCase().includes(needle)
      );
    });
  }, [data, kind, activeOnly, search]);

  const kinds = useMemo(
    () => [...new Set((data?.items ?? []).map((item) => item.kind))].sort(),
    [data],
  );

  const columns: Column<ContentRow>[] = [
    {
      key: 'title',
      header: 'Título',
      rowHeader: true,
      render: (row) => (
        <>
          {pickLocalized(row.title)}
          <br />
          <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
            {truncate(pickLocalized(row.body), 90)}
          </span>
        </>
      ),
    },
    { key: 'kind', header: 'Tipo', render: (row) => kindLabel(row.kind) },
    {
      key: 'active',
      header: 'Publicado',
      render: (row) => (
        <StateTag
          descriptor={
            row.active
              ? { label: 'Publicado', symbol: '✓', tone: 'positivo' }
              : { label: 'Oculto', symbol: '✕', tone: 'neutro' }
          }
        />
      ),
    },
    {
      key: 'priority',
      header: 'Prioridad',
      numeric: true,
      render: (row) => formatNumber(row.priority),
    },
    { key: 'club', header: 'Club', render: (row) => orDash(row.club?.name) },
    {
      key: 'rules',
      header: 'Reglas de aparición',
      render: (row) =>
        row.rules.length === 0 ? (
          'Sin reglas: aparece siempre'
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {row.rules.map((rule) => (
              <li key={rule.id}>
                <Mono>{truncate(JSON.stringify(rule.conditions ?? {}), 60)}</Mono>
                {rule.activeFrom || rule.activeUntil ? (
                  <>
                    <br />
                    <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
                      Vigencia: {rule.activeFrom ? formatDate(rule.activeFrom) : 'sin inicio'} –{' '}
                      {rule.activeUntil ? formatDate(rule.activeUntil) : 'sin fin'}
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'media',
      header: 'Medio y accesibilidad',
      render: (row) =>
        row.mediaUrl ? (
          <>
            <Mono>{truncate(row.mediaUrl, 40)}</Mono>
            <br />
            {/* Un medio sin texto alternativo es contenido inaccesible: se avisa. */}
            {row.mediaAlt ? (
              <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
                Alt: {truncate(row.mediaAlt, 50)}
              </span>
            ) : (
              <StateTag
                descriptor={{ label: 'Sin texto alternativo', symbol: '⚠', tone: 'aviso' }}
              />
            )}
          </>
        ) : (
          'Sin medio'
        ),
    },
  ];

  const sinAlt = (data?.items ?? []).filter((item) => item.mediaUrl && !item.mediaAlt).length;

  return (
    <>
      <PageHeader
        title="Contenido dinámico"
        description="Piezas que el aficionado ve al leer su escudo, con las reglas que deciden cuándo aparecen."
      />

      {sinAlt > 0 ? (
        <Callout variant="aviso" title={`${sinAlt} pieza(s) con medio sin texto alternativo`}>
          <p>
            Un vídeo o imagen sin texto alternativo deja fuera a quien usa lector de pantalla.
            Complete el campo antes de publicar la pieza.
          </p>
        </Callout>
      ) : null}

      <FilterBar>
        <SelectFilter
          label="Tipo"
          value={kind}
          onChange={setKind}
          allLabel="Todos los tipos"
          options={kinds.map((value) => ({ value, label: kindLabel(value) }))}
        />
        <SelectFilter
          label="Publicación"
          value={activeOnly}
          onChange={setActiveOnly}
          allLabel="Todas"
          options={[
            { value: 'si', label: 'Solo publicadas' },
            { value: 'no', label: 'Solo ocultas' },
          ]}
        />
        <SearchFilter
          label="Buscar en título o cuerpo"
          value={search}
          placeholder="hinchada"
          onSubmit={setSearch}
        />
        {kind || activeOnly || search ? (
          <Button
            variant="discreto"
            onClick={() => {
              setKind('');
              setActiveOnly('');
              setSearch('');
            }}
          >
            Limpiar filtros
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Contenido dinámico y sus reglas"
        captionDetail="Ordenado por prioridad descendente: lo primero es lo que se muestra antes."
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          kind || activeOnly || search
            ? 'Ninguna pieza coincide con los filtros.'
            : 'No hay contenido dinámico configurado.'
        }
      />
    </>
  );
}
