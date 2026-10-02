'use client';

import { useState } from 'react';
import { JERSEY_UNIT_STATES } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import { Dialog, DialogActions } from '@/components/Dialog';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import {
  Button,
  Callout,
  Field,
  FilterBar,
  PageHeader,
  Pagination,
  SearchFilter,
  SelectFilter,
  StateTag,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import {
  describeChipState,
  describeUnitState,
  formatDateTime,
  formatNumber,
  orDash,
} from '@/lib/format';
import { hasUiPermission } from '@/lib/permissions';
import type { ClubRow, Listed, OrderRow, Paged, UnitRow } from '@/lib/types';

const PAGE_SIZE = 25;

export default function UnidadesPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['production:read']}>
      <Unidades />
    </GuardedPage>
  );
}

function Unidades(): React.ReactElement {
  const { permissions } = useSession();
  const canRevoke = hasUiPermission(permissions, 'production:revoke');
  const canSeeFullUid = hasUiPermission(permissions, 'chips:read');

  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [clubId, setClubId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [search, setSearch] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<UnitRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filters = { state, clubId, orderId, q: search };

  const { data, error, loading, reload } = useApiQuery<Paged<UnitRow>>('/admin/units', {
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });
  const clubs = useApiQuery<Listed<ClubRow>>('/admin/clubs');
  const orders = useApiQuery<Listed<OrderRow>>('/admin/orders');

  const hasFilters = Boolean(state || clubId || orderId || search);

  function resetFilters(): void {
    setState('');
    setClubId('');
    setOrderId('');
    setSearch('');
    setPage(1);
  }

  const columns: Column<UnitRow>[] = [
    {
      key: 'publicRef',
      header: 'Referencia',
      rowHeader: true,
      render: (row) => <Mono>{row.publicRef}</Mono>,
    },
    {
      key: 'state',
      header: 'Estado de la unidad',
      render: (row) => <StateTag descriptor={describeUnitState(row.state)} />,
    },
    { key: 'club', header: 'Club', render: (row) => row.club },
    {
      key: 'model',
      header: 'Modelo',
      render: (row) => (
        <>
          {row.model}
          <br />
          <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
            {row.season} · {row.edition}
          </span>
        </>
      ),
    },
    {
      key: 'sku',
      header: 'Referencia comercial',
      render: (row) => (
        <>
          {row.sku ? <Mono>{row.sku}</Mono> : '—'}
          {row.size ? ` · talla ${row.size}` : ''}
        </>
      ),
    },
    {
      key: 'chip',
      header: 'Chip',
      render: (row) =>
        row.chipState ? (
          <>
            <StateTag descriptor={describeChipState(row.chipState)} />
            <br />
            <Mono>{row.chipUid}</Mono>
            {row.chipType ? (
              <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
                {' '}
                ({row.chipType})
              </span>
            ) : null}
          </>
        ) : (
          'Sin chip'
        ),
    },
    { key: 'owner', header: 'Con dueño', render: (row) => orDash(row.hasOwner) },
    {
      key: 'interactions',
      header: 'Lecturas',
      numeric: true,
      render: (row) => formatNumber(row.interactions),
    },
    { key: 'activatedAt', header: 'Activada', render: (row) => formatDateTime(row.activatedAt) },
  ];

  if (canRevoke) {
    columns.push({
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <Button
          variant="peligro"
          disabled={row.state === 'REVOKED'}
          onClick={() => setRevokeTarget(row)}
          aria-label={`Revocar la unidad ${row.publicRef}`}
        >
          {row.state === 'REVOKED' ? 'Ya revocada' : 'Revocar'}
        </Button>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Unidades"
        description="Unidades de jersey con su estado, su chip y su histórico de lecturas."
      />

      {!canSeeFullUid ? (
        <Callout variant="info" title="El UID del chip aparece enmascarado">
          <p>
            La API sólo devuelve el UID completo a quien tiene el permiso <code>chips:read</code>.
            Su rol ve una versión enmascarada, suficiente para cotejar una unidad sin exponer el
            identificador del chip.
          </p>
        </Callout>
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <Callout variant="info" title="Revocación registrada">
            <p>{notice}</p>
          </Callout>
        ) : null}
      </div>

      <FilterBar>
        <SelectFilter
          label="Estado"
          value={state}
          onChange={(value) => {
            setState(value);
            setPage(1);
          }}
          allLabel="Todos los estados"
          options={JERSEY_UNIT_STATES.map((value) => ({
            value,
            label: describeUnitState(value).label,
          }))}
        />
        <SelectFilter
          label="Club"
          value={clubId}
          onChange={(value) => {
            setClubId(value);
            setPage(1);
          }}
          allLabel="Todos los clubes"
          options={(clubs.data?.items ?? []).map((club) => ({ value: club.id, label: club.name }))}
        />
        <SelectFilter
          label="Orden de producción"
          value={orderId}
          onChange={(value) => {
            setOrderId(value);
            setPage(1);
          }}
          allLabel="Todas las órdenes"
          options={(orders.data?.items ?? []).map((order) => ({
            value: order.id,
            label: order.code,
          }))}
        />
        <SearchFilter
          label="Buscar por referencia"
          value={search}
          placeholder="MEV-34WE1BSD"
          onSubmit={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        {hasFilters ? (
          <Button variant="discreto" onClick={resetFilters}>
            Limpiar filtros
          </Button>
        ) : null}
        {/* La exportación arrastra los filtros activos, no la página visible. */}
        <ExportCsvButton path="/admin/units" query={filters} fallbackName="unidades.csv" />
      </FilterBar>

      <DataTable
        caption="Unidades de jersey"
        captionDetail={
          hasFilters
            ? 'Resultados filtrados. La exportación CSV usa estos mismos filtros.'
            : 'Todas las unidades registradas.'
        }
        columns={columns}
        rows={data?.items ?? null}
        getRowKey={(row) => row.publicRef}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          hasFilters
            ? 'Ninguna unidad coincide con los filtros.'
            : 'Todavía no hay unidades registradas.'
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

      <RevokeDialog
        unit={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onDone={(message) => {
          setRevokeTarget(null);
          setNotice(message);
          reload();
        }}
      />
    </>
  );
}

/**
 * Revocación de una unidad.
 *
 * El motivo es OBLIGATORIO: revocar corta la titularidad, invalida el
 * certificado y deja el chip fuera de juego. Sin motivo escrito, el registro de
 * auditoría no sirve para reconstruir por qué se hizo.
 *
 * Limitación conocida del contrato actual: `GET /admin/units` no devuelve el
 * identificador interno de la unidad (sólo su referencia pública), y
 * `POST /admin/units/:id/revoke` lo exige. Hasta que el listado lo incluya, hay
 * que pegarlo a mano. Se dice aquí en vez de fingir que el botón funciona solo.
 */
function RevokeDialog({
  unit,
  onClose,
  onDone,
}: {
  unit: UnitRow | null;
  onClose(): void;
  onDone(message: string): void;
}): React.ReactElement {
  const { api } = useSession();
  const [reason, setReason] = useState('');
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!unit) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/units/${unitId.trim()}/revoke`, { reason: reason.trim() });
      onDone(`La unidad ${unit.publicRef} quedó revocada. Motivo registrado en auditoría.`);
      setReason('');
      setUnitId('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo revocar la unidad.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={unit !== null} title="Revocar unidad" onClose={onClose}>
      {unit ? (
        <form onSubmit={handleSubmit}>
          <Callout variant="peligro" title="Esta acción no se deshace">
            <p>
              Revocar la unidad <Mono>{unit.publicRef}</Mono> pasa su chip a estado revocado,
              invalida su certificado digital y cierra la titularidad activa. El aficionado que la
              verifique verá «producto revocado».
            </p>
          </Callout>

          <Field
            label="Identificador interno de la unidad (UUID)"
            hint="El listado de unidades todavía no lo expone; cópielo del registro de auditoría o de la ficha de la unidad."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                required
                pattern="[0-9a-fA-F-]{36}"
                placeholder="2c845872-1ecc-44ce-a6af-757edbdb3ac4"
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Motivo de la revocación (obligatorio)"
            hint="Entre 5 y 500 caracteres. Queda en el registro de auditoría."
          >
            {(props) => (
              <textarea
                {...props}
                rows={3}
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>

          <div aria-live="assertive">
            {error ? (
              <Callout variant="peligro" title="No se pudo revocar">
                <p>{error}</p>
              </Callout>
            ) : null}
          </div>

          <DialogActions>
            <Button onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="peligro"
              disabled={busy || reason.trim().length < 5 || unitId.trim().length < 36}
              aria-busy={busy || undefined}
            >
              {busy ? 'Revocando…' : 'Revocar unidad'}
            </Button>
          </DialogActions>
        </form>
      ) : null}
    </Dialog>
  );
}
