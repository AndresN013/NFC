'use client';

import { useState } from 'react';
import { ROLES, type Role, type ScopeType } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { DataTable, Mono, type Column } from '@/components/DataTable';
import {
  Actions,
  Button,
  Callout,
  Field,
  FilterBar,
  FormCard,
  FormRow,
  PageHeader,
  Pagination,
  SearchFilter,
  StateTag,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, formatBoolean } from '@/lib/format';
import { hasUiPermission } from '@/lib/permissions';
import type { Paged, UserRow } from '@/lib/types';

const PAGE_SIZE = 25;
const SCOPE_TYPES: ScopeType[] = ['GLOBAL', 'ORGANIZATION', 'CLUB', 'CAMPAIGN'];

export default function UsuariosPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['users:read']}>
      <Usuarios />
    </GuardedPage>
  );
}

function Usuarios(): React.ReactElement {
  const { api, permissions, session } = useSession();
  const canWrite = hasUiPermission(permissions, 'users:write');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, error, loading, reload } = useApiQuery<Paged<UserRow>>('/admin/users', {
    page,
    pageSize: PAGE_SIZE,
    q: search,
  });

  async function toggleActive(user: UserRow): Promise<void> {
    setActionError(null);
    setNotice(null);
    setPendingId(user.id);
    try {
      const result = await api.patch<{ ok: boolean; sessionsRevoked: number }>(
        `/admin/users/${user.id}/active`,
        { active: !user.active },
      );
      setNotice(
        user.active
          ? `Se desactivó a ${user.email}. Sesiones cerradas: ${result.sessionsRevoked}.`
          : `Se activó a ${user.email}.`,
      );
      reload();
    } catch (cause) {
      // Un 403 aqui es normal y esperado: la API es quien decide.
      setActionError(
        cause instanceof ApiError ? cause.message : 'No se pudo cambiar el estado del usuario.',
      );
    } finally {
      setPendingId(null);
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: 'displayName',
      header: 'Nombre',
      rowHeader: true,
      render: (row) => row.displayName,
    },
    { key: 'email', header: 'Correo', render: (row) => <Mono>{row.email}</Mono> },
    {
      key: 'roles',
      header: 'Roles y alcance',
      render: (row) =>
        row.roles.length === 0 ? (
          'Sin roles'
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {row.roles.map((assignment, index) => (
              <li key={`${assignment.role}-${assignment.scopeId ?? 'global'}-${index}`}>
                {assignment.role}
                {assignment.scopeType === 'GLOBAL' ? (
                  ' (global)'
                ) : (
                  <>
                    {' '}
                    ({assignment.scopeType.toLowerCase()}:{' '}
                    <Mono>{assignment.scopeId?.slice(0, 8) ?? '—'}</Mono>)
                  </>
                )}
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'active',
      header: 'Estado',
      render: (row) => (
        <StateTag
          descriptor={
            row.active
              ? { label: 'Activo', symbol: '✓', tone: 'positivo' }
              : { label: 'Inactivo', symbol: '✕', tone: 'peligro' }
          }
        />
      ),
    },
    { key: 'mfa', header: 'MFA', render: (row) => formatBoolean(row.mfaEnabled) },
    { key: 'lastLogin', header: 'Último acceso', render: (row) => formatDateTime(row.lastLoginAt) },
  ];

  if (canWrite) {
    columns.push({
      key: 'acciones',
      header: 'Acciones',
      render: (row) => {
        const isSelf = row.id === session?.user.id;
        return (
          <Button
            variant={row.active ? 'peligro' : 'normal'}
            onClick={() => void toggleActive(row)}
            disabled={pendingId === row.id || (isSelf && row.active)}
            title={
              isSelf && row.active ? 'No puede desactivar su propia cuenta.' : undefined
            }
            aria-label={`${row.active ? 'Desactivar' : 'Activar'} a ${row.displayName}`}
          >
            {pendingId === row.id ? 'Guardando…' : row.active ? 'Desactivar' : 'Activar'}
          </Button>
        );
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Cuentas del personal interno y su alcance. Desactivar una cuenta cierra sus sesiones de inmediato."
        actions={
          canWrite ? (
            <Button
              variant="primario"
              onClick={() => setShowForm((value) => !value)}
              aria-expanded={showForm}
            >
              {showForm ? 'Cancelar alta' : 'Dar de alta usuario'}
            </Button>
          ) : null
        }
      />

      {!canWrite ? (
        <Callout variant="info">
          <p>
            Su rol permite consultar usuarios, pero no crearlos ni cambiar su estado (falta
            <code> users:write</code>).
          </p>
        </Callout>
      ) : null}

      {showForm && canWrite ? (
        <NuevoUsuario
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
        <SearchFilter
          label="Buscar por nombre o correo"
          value={search}
          placeholder="ana@escudovivo.local"
          onSubmit={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        {search ? (
          <Actions>
            <Button
              variant="discreto"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
            >
              Quitar búsqueda
            </Button>
          </Actions>
        ) : null}
      </FilterBar>

      <DataTable
        caption="Usuarios del panel"
        captionDetail={
          search ? `Filtrado por «${search}».` : 'Todas las cuentas activas e inactivas.'
        }
        columns={columns}
        rows={data?.items ?? null}
        getRowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={
          search
            ? 'Ningún usuario coincide con la búsqueda.'
            : 'Todavía no hay usuarios registrados.'
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

function NuevoUsuario({ onCreated }: { onCreated(message: string): void }): React.ReactElement {
  const { api } = useSession();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('SUPPORT');
  const [scopeType, setScopeType] = useState<ScopeType>('GLOBAL');
  const [scopeId, setScopeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsScopeId = scopeType !== 'GLOBAL';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/users', {
        email,
        displayName,
        password,
        roles: [
          {
            role,
            scopeType,
            // Un rol con alcance sin id seria un rol global encubierto: la API lo rechaza.
            scopeId: needsScopeId ? scopeId : null,
          },
        ],
      });
      onCreated(`Usuario ${email} creado con el rol ${role}.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo crear el usuario.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard
      title="Nuevo usuario"
      onSubmit={handleSubmit}
      footer={
        <Button type="submit" variant="primario" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Creando…' : 'Crear usuario'}
        </Button>
      }
    >
      <FormRow>
        <Field label="Correo electrónico">
          {(props) => (
            <input
              {...props}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label="Nombre visible">
          {(props) => (
            <input
              {...props}
              type="text"
              required
              minLength={2}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          )}
        </Field>
      </FormRow>

      <Field
        label="Contraseña inicial"
        hint="La API exige una contraseña robusta; si la rechaza, el motivo aparece aquí abajo."
      >
        {(props) => (
          <input
            {...props}
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>

      <FormRow>
        <Field label="Rol">
          {(props) => (
            <select
              {...props}
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tipo de alcance">
          {(props) => (
            <select
              {...props}
              value={scopeType}
              onChange={(event) => setScopeType(event.target.value as ScopeType)}
            >
              {SCOPE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Identificador del alcance"
          hint={
            needsScopeId
              ? 'UUID del club, organización o campaña.'
              : 'No aplica a un rol global.'
          }
        >
          {(props) => (
            <input
              {...props}
              type="text"
              value={scopeId}
              required={needsScopeId}
              disabled={!needsScopeId}
              onChange={(event) => setScopeId(event.target.value)}
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
