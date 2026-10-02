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
import { formatDateTime, formatNumber, orDash } from '@/lib/format';
import { hasUiPermission } from '@/lib/permissions';
import type { DeviceRow, Listed } from '@/lib/types';

export default function DispositivosPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['devices:read']}>
      <Dispositivos />
    </GuardedPage>
  );
}

function Dispositivos(): React.ReactElement {
  const { api, permissions } = useSession();
  const canWrite = hasUiPermission(permissions, 'devices:write');

  const { data, error, loading, reload } = useApiQuery<Listed<DeviceRow>>('/admin/devices');
  const [active, setActive] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const items = data?.items ?? null;
    if (!items || !active) return items;
    return items.filter((device) => (active === 'si' ? device.active : !device.active));
  }, [data, active]);

  async function toggle(device: DeviceRow): Promise<void> {
    setActionError(null);
    setNotice(null);
    setPendingId(device.id);
    try {
      const result = await api.patch<{ ok: boolean; sessionsRevoked: number }>(
        `/admin/devices/${device.id}/active`,
        { active: !device.active },
      );
      setNotice(
        device.active
          ? `Se deshabilitó «${device.label}». Sesiones cerradas: ${result.sessionsRevoked}.`
          : `Se habilitó «${device.label}».`,
      );
      reload();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError ? cause.message : 'No se pudo cambiar el estado del teléfono.',
      );
    } finally {
      setPendingId(null);
    }
  }

  const columns: Column<DeviceRow>[] = [
    { key: 'label', header: 'Teléfono', rowHeader: true, render: (row) => row.label },
    { key: 'deviceId', header: 'Identificador', render: (row) => <Mono>{row.deviceId}</Mono> },
    {
      key: 'active',
      header: 'Autorización',
      render: (row) => (
        <StateTag
          descriptor={
            row.active
              ? { label: 'Habilitado', symbol: '✓', tone: 'positivo' }
              : { label: 'Deshabilitado', symbol: '✕', tone: 'peligro' }
          }
        />
      ),
    },
    {
      key: 'attestation',
      header: 'Atestación',
      render: (row) => (
        <StateTag
          descriptor={
            row.attestationVerified
              ? { label: 'Verificada', symbol: '✓', tone: 'positivo' }
              : { label: 'Sin verificar', symbol: '⚠', tone: 'aviso' }
          }
        />
      ),
    },
    { key: 'model', header: 'Modelo', render: (row) => orDash(row.model) },
    { key: 'os', header: 'Sistema', render: (row) => orDash(row.osVersion) },
    { key: 'station', header: 'Puesto', render: (row) => orDash(row.station) },
    { key: 'operator', header: 'Operario', render: (row) => orDash(row.operator) },
    { key: 'lastSeen', header: 'Última señal', render: (row) => formatDateTime(row.lastSeenAt) },
  ];

  if (canWrite) {
    columns.push({
      key: 'acciones',
      header: 'Acciones',
      render: (row) => (
        <Button
          variant={row.active ? 'peligro' : 'normal'}
          onClick={() => void toggle(row)}
          disabled={pendingId === row.id}
          aria-label={`${row.active ? 'Deshabilitar' : 'Habilitar'} el teléfono ${row.label}`}
        >
          {pendingId === row.id ? 'Guardando…' : row.active ? 'Deshabilitar' : 'Habilitar'}
        </Button>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Teléfonos autorizados"
        description="Dispositivos de planta que pueden operar la aplicación de producción. Deshabilitar uno cierra sus sesiones al instante."
        actions={
          canWrite ? (
            <Button
              variant="primario"
              onClick={() => setShowForm((value) => !value)}
              aria-expanded={showForm}
            >
              {showForm ? 'Cancelar alta' : 'Autorizar teléfono'}
            </Button>
          ) : null
        }
      />

      <Callout variant="aviso" title="La atestación del dispositivo llega en la fase 2">
        <p>
          Hoy la API devuelve <code>attestationVerified: false</code> para todos los teléfonos: no
          se comprueba criptográficamente que el dispositivo sea el que dice ser. La autorización es
          una lista declarada por un administrador, no una prueba de integridad del teléfono.
        </p>
      </Callout>

      {!canWrite ? (
        <Callout variant="info">
          <p>
            Su rol permite consultar los teléfonos, pero no autorizarlos ni deshabilitarlos (falta
            <code> devices:write</code>).
          </p>
        </Callout>
      ) : null}

      {showForm && canWrite ? (
        <NuevoDispositivo
          onCreated={(message) => {
            setShowForm(false);
            setNotice(message);
            reload();
          }}
        />
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <Callout variant="info" title="Cambio aplicado">
            <p>{notice}</p>
          </Callout>
        ) : null}
        {actionError ? (
          <Callout variant="peligro" title="No se pudo completar la acción">
            <p>{actionError}</p>
          </Callout>
        ) : null}
      </div>

      <FilterBar>
        <SelectFilter
          label="Autorización"
          value={active}
          onChange={setActive}
          allLabel="Todos"
          options={[
            { value: 'si', label: 'Solo habilitados' },
            { value: 'no', label: 'Solo deshabilitados' },
          ]}
        />
        {active ? (
          <Button variant="discreto" onClick={() => setActive('')}>
            Quitar filtro
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Teléfonos autorizados de producción"
        captionDetail={`${formatNumber(rows?.length ?? 0)} teléfono(s).`}
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          active ? 'Ningún teléfono en ese estado.' : 'No hay teléfonos autorizados todavía.'
        }
      />
    </>
  );
}

function NuevoDispositivo({
  onCreated,
}: {
  onCreated(message: string): void;
}): React.ReactElement {
  const { api } = useSession();
  const [deviceId, setDeviceId] = useState('');
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [osVersion, setOsVersion] = useState('');
  const [stationId, setStationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { deviceId: deviceId.trim(), label: label.trim() };
      if (model.trim()) body.model = model.trim();
      if (osVersion.trim()) body.osVersion = osVersion.trim();
      if (stationId.trim()) body.stationId = stationId.trim();
      await api.post('/admin/devices', body);
      onCreated(`Teléfono «${label}» autorizado.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo autorizar el teléfono.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard
      title="Autorizar un teléfono"
      onSubmit={handleSubmit}
      footer={
        <Button type="submit" variant="primario" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Autorizando…' : 'Autorizar teléfono'}
        </Button>
      }
    >
      <FormRow>
        <Field label="Identificador del dispositivo" hint="Mínimo 8 caracteres. Lo reporta la app.">
          {(props) => (
            <input
              {...props}
              type="text"
              required
              minLength={8}
              maxLength={200}
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            />
          )}
        </Field>
        <Field label="Etiqueta" hint="Nombre reconocible en planta.">
          {(props) => (
            <input
              {...props}
              type="text"
              required
              minLength={2}
              maxLength={120}
              placeholder="Teléfono planta 02"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          )}
        </Field>
      </FormRow>

      <FormRow>
        <Field label="Modelo (opcional)">
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={120}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
        </Field>
        <Field label="Versión del sistema (opcional)">
          {(props) => (
            <input
              {...props}
              type="text"
              maxLength={60}
              placeholder="Android 14"
              value={osVersion}
              onChange={(event) => setOsVersion(event.target.value)}
            />
          )}
        </Field>
        <Field label="Puesto de trabajo (UUID, opcional)">
          {(props) => (
            <input
              {...props}
              type="text"
              pattern="[0-9a-fA-F-]{36}"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
            />
          )}
        </Field>
      </FormRow>

      <div aria-live="assertive">
        {error ? (
          <Callout variant="peligro" title="La API rechazó el alta">
            <p>{error}</p>
          </Callout>
        ) : null}
      </div>
    </FormCard>
  );
}
