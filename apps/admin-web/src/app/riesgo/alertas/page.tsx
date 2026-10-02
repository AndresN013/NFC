'use client';

import { useState } from 'react';
import { RISK_LEVELS } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import { Dialog, DialogActions } from '@/components/Dialog';
import {
  Button,
  Callout,
  Field,
  FilterBar,
  PageHeader,
  Pagination,
  SelectFilter,
  StateTag,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import {
  describeAlertState,
  describeRiskLevel,
  describeUnitState,
  formatDateTime,
  orDash,
  trustLevelLabel,
  verificationMethodLabel,
} from '@/lib/format';
import { hasUiPermission } from '@/lib/permissions';
import type { AlertRow, Paged } from '@/lib/types';

const PAGE_SIZE = 25;
const ALERT_STATES = ['OPEN', 'IN_REVIEW', 'CONFIRMED', 'DISMISSED'] as const;
type AlertState = (typeof ALERT_STATES)[number];

export default function AlertasPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['alerts:read']}>
      <Alertas />
    </GuardedPage>
  );
}

function Alertas(): React.ReactElement {
  const { permissions } = useSession();
  const canReview = hasUiPermission(permissions, 'alerts:write');

  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [target, setTarget] = useState<AlertRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, error, loading, reload } = useApiQuery<Paged<AlertRow>>('/admin/alerts', {
    page,
    pageSize: PAGE_SIZE,
    state,
    riskLevel,
  });

  const columns: Column<AlertRow>[] = [
    {
      key: 'riskLevel',
      header: 'Nivel',
      rowHeader: true,
      render: (row) => <StateTag descriptor={describeRiskLevel(row.riskLevel)} />,
    },
    {
      key: 'state',
      header: 'Estado',
      render: (row) => <StateTag descriptor={describeAlertState(row.state)} />,
    },
    {
      key: 'summary',
      header: 'Resumen',
      render: (row) => (
        <>
          {orDash(row.summary)}
          {row.reasonCodes.length > 0 ? (
            <>
              <br />
              <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
                Motivos: {row.reasonCodes.join(', ')}
              </span>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'unit',
      header: 'Unidad',
      render: (row) =>
        row.unitRef ? (
          <>
            <Mono>{row.unitRef}</Mono>
            {row.unitState ? (
              <>
                <br />
                <StateTag descriptor={describeUnitState(row.unitState)} />
              </>
            ) : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      key: 'verification',
      header: 'Lectura que la originó',
      render: (row) => (
        <>
          {row.method ? verificationMethodLabel(row.method) : '—'}
          <br />
          <span style={{ color: 'var(--color-texto-suave)', fontSize: '0.85rem' }}>
            {row.trustLevel ? trustLevelLabel(row.trustLevel) : '—'}
            {row.countryCode ? ` · ${row.countryCode}` : ''}
          </span>
        </>
      ),
    },
    { key: 'createdAt', header: 'Detectada', render: (row) => formatDateTime(row.createdAt) },
    { key: 'reviewedAt', header: 'Revisada', render: (row) => formatDateTime(row.reviewedAt) },
  ];

  if (canReview) {
    columns.push({
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <Button onClick={() => setTarget(row)} aria-label={`Revisar la alerta de nivel ${row.riskLevel}`}>
          Revisar
        </Button>
      ),
    });
  }

  const hasFilters = Boolean(state || riskLevel);

  return (
    <>
      <PageHeader
        title="Alertas de riesgo"
        description="Cola de revisión humana. El motor de riesgo propone; una persona decide."
      />

      <Callout variant="info" title="Una alerta no es una condena">
        <p>
          Una alerta señala un patrón inusual, no una falsificación probada. Antes de confirmarla,
          contraste con el caso de soporte y el histórico de la unidad: marcar como confirmada afecta
          a lo que ve el aficionado.
        </p>
      </Callout>

      {!canReview ? (
        <Callout variant="info">
          <p>
            Su rol permite consultar las alertas, pero no registrar la revisión (falta
            <code> alerts:write</code>).
          </p>
        </Callout>
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <Callout variant="info" title="Revisión registrada">
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
          options={ALERT_STATES.map((value) => ({
            value,
            label: describeAlertState(value).label,
          }))}
        />
        <SelectFilter
          label="Nivel de riesgo"
          value={riskLevel}
          onChange={(value) => {
            setRiskLevel(value);
            setPage(1);
          }}
          allLabel="Todos los niveles"
          options={RISK_LEVELS.map((value) => ({ value, label: describeRiskLevel(value).label }))}
        />
        {hasFilters ? (
          <Button
            variant="discreto"
            onClick={() => {
              setState('');
              setRiskLevel('');
              setPage(1);
            }}
          >
            Limpiar filtros
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Alertas de riesgo"
        captionDetail="Ordenadas por nivel de riesgo y fecha de detección."
        columns={columns}
        rows={data?.items ?? null}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          hasFilters
            ? 'Ninguna alerta coincide con los filtros.'
            : 'No hay alertas de riesgo registradas.'
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

      <ReviewDialog
        alert={target}
        onClose={() => setTarget(null)}
        onDone={(message) => {
          setTarget(null);
          setNotice(message);
          reload();
        }}
      />
    </>
  );
}

/** Revision humana de una alerta: estado nuevo y notas de quien decide. */
function ReviewDialog({
  alert,
  onClose,
  onDone,
}: {
  alert: AlertRow | null;
  onClose(): void;
  onDone(message: string): void;
}): React.ReactElement {
  const { api } = useSession();
  const [state, setState] = useState<AlertState>('IN_REVIEW');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!alert) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { state };
      if (notes.trim()) body.reviewNotes = notes.trim();
      await api.patch(`/admin/alerts/${alert.id}`, body);
      onDone(`Alerta marcada como «${describeAlertState(state).label}».`);
      setNotes('');
      setState('IN_REVIEW');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo guardar la revisión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={alert !== null} title="Revisar alerta" onClose={onClose}>
      {alert ? (
        <form onSubmit={handleSubmit}>
          <p>
            <StateTag descriptor={describeRiskLevel(alert.riskLevel)} />{' '}
            {alert.unitRef ? (
              <>
                sobre la unidad <Mono>{alert.unitRef}</Mono>
              </>
            ) : null}
          </p>
          <p>{orDash(alert.summary)}</p>

          <Field label="Nuevo estado">
            {(props) => (
              <select
                {...props}
                value={state}
                onChange={(event) => setState(event.target.value as AlertState)}
              >
                {ALERT_STATES.map((value) => (
                  <option key={value} value={value}>
                    {describeAlertState(value).label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Notas de la revisión"
            hint="Qué se comprobó y por qué se decide así. Hasta 2000 caracteres."
          >
            {(props) => (
              <textarea
                {...props}
                rows={4}
                maxLength={2000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            )}
          </Field>

          <div aria-live="assertive">
            {error ? (
              <Callout variant="peligro" title="No se pudo guardar">
                <p>{error}</p>
              </Callout>
            ) : null}
          </div>

          <DialogActions>
            <Button onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" variant="primario" disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Guardando…' : 'Guardar revisión'}
            </Button>
          </DialogActions>
        </form>
      ) : null}
    </Dialog>
  );
}
