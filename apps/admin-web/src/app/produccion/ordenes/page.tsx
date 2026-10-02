'use client';

import { useMemo, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import {
  Button,
  Callout,
  Field,
  FilterBar,
  FormCard,
  FormRow,
  PageHeader,
  SelectFilter,
  StateTag,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, formatNumber, orDash, orderStateLabel, truncate } from '@/lib/format';
import { hasUiPermission } from '@/lib/permissions';
import type { ClubRow, Listed, OrderRow } from '@/lib/types';

export default function OrdenesPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['production:read']}>
      <Ordenes />
    </GuardedPage>
  );
}

function Ordenes(): React.ReactElement {
  const { permissions } = useSession();
  const canWrite = hasUiPermission(permissions, 'production:write');

  const { data, error, loading, reload } = useApiQuery<Listed<OrderRow>>('/admin/orders');
  const [state, setState] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // `GET /admin/orders` no acepta filtros: se filtra por estado en el cliente.
  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !state) return items;
    return items.filter((order) => order.state === state);
  }, [data, state]);

  const states = useMemo(
    () => [...new Set((data?.items ?? []).map((order) => order.state))].sort(),
    [data],
  );

  const columns: Column<OrderRow>[] = [
    { key: 'code', header: 'Orden', rowHeader: true, render: (row) => <Mono>{row.code}</Mono> },
    {
      key: 'state',
      header: 'Estado',
      render: (row) => (
        <StateTag
          descriptor={{
            label: orderStateLabel(row.state),
            symbol: row.state === 'CLOSED' ? '✓' : row.state === 'CANCELLED' ? '✕' : '⟳',
            tone:
              row.state === 'CANCELLED' ? 'peligro' : row.state === 'CLOSED' ? 'positivo' : 'neutro',
          }}
        />
      ),
    },
    {
      key: 'planned',
      header: 'Unidades previstas',
      numeric: true,
      render: (row) => formatNumber(row.plannedUnits),
    },
    {
      key: 'produced',
      header: 'Unidades registradas',
      numeric: true,
      render: (row) => formatNumber(row._count.units),
    },
    { key: 'jobs', header: 'Trabajos', numeric: true, render: (row) => formatNumber(row._count.jobs) },
    {
      key: 'batches',
      header: 'Lotes',
      render: (row) =>
        row.batches.length === 0 ? (
          'Sin lotes'
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {row.batches.map((batch) => (
              <li key={batch.id}>
                <Mono>{batch.code}</Mono>
                {/* Un lote marcado se anuncia con texto, no con un punto de color. */}
                {batch.flagged ? ' — marcado por calidad' : ''}
              </li>
            ))}
          </ul>
        ),
    },
    { key: 'createdAt', header: 'Creada', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'notes',
      header: 'Notas',
      render: (row) => orDash(row.notes ? truncate(row.notes, 60) : null),
    },
  ];

  return (
    <>
      <PageHeader
        title="Órdenes de producción"
        description="Órdenes abiertas y cerradas, con su avance frente a lo planificado."
        actions={
          canWrite ? (
            <Button
              variant="primario"
              onClick={() => setShowForm((value) => !value)}
              aria-expanded={showForm}
            >
              {showForm ? 'Cancelar alta' : 'Crear orden'}
            </Button>
          ) : null
        }
      />

      {!canWrite ? (
        <Callout variant="info">
          <p>
            Su rol permite consultar las órdenes, pero no crearlas (falta
            <code> production:write</code>).
          </p>
        </Callout>
      ) : null}

      {showForm && canWrite ? (
        <NuevaOrden
          onCreated={(message) => {
            setShowForm(false);
            setNotice(message);
            reload();
          }}
        />
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <Callout variant="info" title="Orden creada">
            <p>{notice}</p>
          </Callout>
        ) : null}
      </div>

      <FilterBar>
        <SelectFilter
          label="Estado"
          value={state}
          onChange={setState}
          allLabel="Todos los estados"
          options={states.map((value) => ({ value, label: orderStateLabel(value) }))}
        />
        {state ? (
          <Button variant="discreto" onClick={() => setState('')}>
            Quitar filtro
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Órdenes de producción"
        captionDetail={`${formatNumber(rows?.length ?? 0)} orden(es).`}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          state ? 'Ninguna orden en ese estado.' : 'Todavía no hay órdenes de producción.'
        }
      />
    </>
  );
}

function NuevaOrden({ onCreated }: { onCreated(message: string): void }): React.ReactElement {
  const { api } = useSession();
  const clubs = useApiQuery<Listed<ClubRow>>('/admin/clubs');
  const [organizationId, setOrganizationId] = useState('');
  const [code, setCode] = useState('');
  const [plannedUnits, setPlannedUnits] = useState('100');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // La organización se deduce del catálogo de clubes: es el único endpoint del
  // panel que la expone, y una orden siempre pertenece a una organización.
  const organizations = useMemo(() => {
    const map = new Map<string, string>();
    for (const club of clubs.data?.items ?? []) {
      if (!map.has(club.organizationId)) map.set(club.organizationId, club.name);
    }
    return [...map.entries()].map(([id, name]) => ({
      value: id,
      label: `${name} (${id.slice(0, 8)})`,
    }));
  }, [clubs.data]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        organizationId,
        code,
        plannedUnits: Number(plannedUnits),
      };
      if (notes.trim()) body.notes = notes.trim();
      await api.post('/admin/orders', body);
      onCreated(`Orden ${code} creada con ${plannedUnits} unidades previstas.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo crear la orden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard
      title="Nueva orden de producción"
      onSubmit={handleSubmit}
      footer={
        <Button type="submit" variant="primario" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Creando…' : 'Crear orden'}
        </Button>
      }
    >
      <FormRow>
        <Field
          label="Organización"
          hint={
            organizations.length === 0
              ? 'Cargando organizaciones del catálogo…'
              : 'Deducida del catálogo de clubes.'
          }
        >
          {(props) => (
            <select
              {...props}
              required
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
            >
              <option value="">Seleccione una organización</option>
              {organizations.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Código de la orden" hint="Entre 3 y 60 caracteres.">
          {(props) => (
            <input
              {...props}
              type="text"
              required
              minLength={3}
              maxLength={60}
              placeholder="OP-2026-0002"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
        </Field>
        <Field label="Unidades previstas">
          {(props) => (
            <input
              {...props}
              type="number"
              required
              min={1}
              max={1000000}
              value={plannedUnits}
              onChange={(event) => setPlannedUnits(event.target.value)}
            />
          )}
        </Field>
      </FormRow>

      <Field label="Notas (opcional)">
        {(props) => (
          <textarea
            {...props}
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </Field>

      <div aria-live="assertive">
        {error ? (
          <Callout variant="peligro" title="La API rechazó la orden">
            <p>{error}</p>
          </Callout>
        ) : null}
      </div>
    </FormCard>
  );
}
