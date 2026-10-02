'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  PRIVACY_REQUEST_SLA_DAYS,
  PRIVACY_REQUEST_STATES,
  PRIVACY_REQUEST_STATE_COPY,
  PRIVACY_REQUEST_TYPE_COPY,
} from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { Dialog, DialogActions } from '@/components/Dialog';
import {
  Actions,
  Button,
  Callout,
  DefinitionList,
  FormCard,
  PageHeader,
  SelectFilter,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

/**
 * Detalle y resolucion de una solicitud de derechos sobre datos personales.
 *
 * Esta pantalla es la que hace APLICABLE el plazo de atencion. Antes existia el
 * plazo y no existia forma de cerrar una solicitud, lo que dejaba la obligacion
 * declarada y sin cumplir.
 *
 * La eliminacion se trata como lo que es: una operacion IRREVERSIBLE. Va en un
 * dialogo aparte, con confirmacion explicita y explicando de antemano que se
 * destruye y que se conserva.
 */

// Los textos vienen del dominio: son los mismos que muestra el listado.
const TYPE_COPY = PRIVACY_REQUEST_TYPE_COPY as Record<string, string>;
const STATE_COPY = PRIVACY_REQUEST_STATE_COPY as Record<string, string>;

interface SolicitudDetalle {
  id: string;
  type: string;
  state: string;
  email: string;
  details: string | null;
  createdAt: string;
  dueAt: string;
  overdue: boolean;
  resolvedAt: string | null;
  resolution: string | null;
  deletionExecutedAt: string | null;
  hasAccount: boolean;
  accountAnonymized: boolean;
}

export default function SolicitudPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['privacy:read']}>
      <Solicitud />
    </GuardedPage>
  );
}

function Solicitud(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const { api, permissions } = useSession();
  const id = params?.id ?? null;

  const { data, error, loading, reload } = useApiQuery<SolicitudDetalle>(
    id ? `/admin/privacy-requests/${id}` : null,
  );

  const puedeEscribir = permissions.includes('privacy:write');

  const [estado, setEstado] = useState('');
  const [resolucion, setResolucion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);

  async function ejecutar(accion: () => Promise<unknown>, mensaje: string): Promise<void> {
    setFallo(null);
    setAviso(null);
    setEnviando(true);
    try {
      await accion();
      setAviso(mensaje);
      reload();
    } catch (cause) {
      setFallo(cause instanceof ApiError ? cause.message : 'Ocurrió un error inesperado.');
    } finally {
      setEnviando(false);
    }
  }

  function guardar(): void {
    if (!estado) {
      setFallo('Elija el estado al que quiere pasar la solicitud.');
      return;
    }
    void ejecutar(
      () =>
        api.patch(`/admin/privacy-requests/${id}`, {
          state: estado,
          resolution: resolucion.trim() || undefined,
        }),
      'Solicitud actualizada.',
    );
  }

  function ejecutarEliminacion(): void {
    setDialogoAbierto(false);
    void ejecutar(
      () => api.post(`/admin/privacy-requests/${id}/execute-deletion`, { confirm: true }),
      'Eliminación ejecutada. Los datos identificativos fueron destruidos.',
    );
  }

  if (loading && !data) return <p>Cargando la solicitud…</p>;

  if (error) {
    return (
      <Callout variant="peligro" title="No se pudo cargar la solicitud">
        {error.message}
      </Callout>
    );
  }

  if (!data) {
    return (
      <Callout variant="info" title="Solicitud no encontrada">
        Revise el enlace.
      </Callout>
    );
  }

  const esEliminacion = data.type === 'DELETION';
  const eliminacionPendiente = esEliminacion && data.hasAccount && !data.deletionExecutedAt;

  return (
    <>
      <PageHeader
        title={TYPE_COPY[data.type] ?? data.type}
        description={`Recibida el ${formatDateTime(data.createdAt)} · Plazo interno de ${PRIVACY_REQUEST_SLA_DAYS} días`}
      />

      <p>
        <Link href="/privacidad/solicitudes">Volver a la lista de solicitudes</Link>
      </p>

      {data.overdue ? (
        <Callout variant="peligro" title="Fuera de plazo">
          {/* El aviso es explícito y no solo un color en una tabla: una solicitud
              vencida es un incumplimiento, no un detalle estético. */}
          El plazo interno de atención venció el {formatDateTime(data.dueAt)}. Atiéndala con
          prioridad.
        </Callout>
      ) : null}

      {aviso ? (
        <div role="status" aria-live="polite">
          <Callout variant="info" title="Hecho">
            {aviso}
          </Callout>
        </div>
      ) : null}

      {fallo ? (
        <Callout variant="peligro" title="No se pudo completar la acción">
          {fallo}
        </Callout>
      ) : null}

      <FormCard title="Datos de la solicitud">
        <DefinitionList
          items={[
            { term: 'Estado', value: STATE_COPY[data.state] ?? data.state },
            { term: 'Correo de contacto', value: data.email },
            { term: 'Plazo', value: formatDateTime(data.dueAt) },
            {
              term: 'Cuenta asociada',
              value: data.hasAccount
                ? data.accountAnonymized
                  ? 'Sí, ya anonimizada'
                  : 'Sí'
                : 'No existe cuenta con ese correo',
            },
            { term: 'Detalles', value: data.details ?? '—' },
            {
              term: 'Resuelta',
              value: data.resolvedAt ? formatDateTime(data.resolvedAt) : 'Todavía no',
            },
            { term: 'Resolución registrada', value: data.resolution ?? '—' },
            ...(esEliminacion
              ? [
                  {
                    term: 'Eliminación ejecutada',
                    value: data.deletionExecutedAt
                      ? formatDateTime(data.deletionExecutedAt)
                      : 'No ejecutada',
                  },
                ]
              : []),
          ]}
        />
      </FormCard>

      {eliminacionPendiente && puedeEscribir ? (
        <FormCard title="Ejecutar la eliminación de datos">
          <Callout variant="peligro" title="Operación irreversible">
            Se destruirán el correo, el nombre y la contraseña de la cuenta, se cerrarán sus
            titularidades y se revocarán sus sesiones. Se conservarán las filas de consentimiento
            y de canje como prueba de que hubo una decisión y una operación, ya sin vínculo con una
            persona identificable. No hay forma de deshacerlo.
          </Callout>
          <Actions>
            <Button variant="peligro" onClick={() => setDialogoAbierto(true)} disabled={enviando}>
              Ejecutar la eliminación
            </Button>
          </Actions>
        </FormCard>
      ) : null}

      {esEliminacion && !data.hasAccount ? (
        <Callout variant="info" title="No hay cuenta que anonimizar">
          Ese correo no tiene una cuenta asociada. Cierre la solicitud indicando en la resolución
          que no existía información vinculada a ese correo.
        </Callout>
      ) : null}

      {puedeEscribir ? (
        <FormCard title="Resolver la solicitud">
          <SelectFilter
            label="Nuevo estado"
            value={estado}
            onChange={setEstado}
            options={PRIVACY_REQUEST_STATES.map((value) => ({
              value,
              label: STATE_COPY[value] ?? value,
            }))}
            allLabel="Elija un estado"
          />

          <label htmlFor="resolucion">
            Cómo se resolvió{' '}
            <span aria-hidden="true">*</span>
            <span style={{ position: 'absolute', left: -9999 }}> (obligatorio para cerrarla)</span>
          </label>
          <textarea
            id="resolucion"
            value={resolucion}
            onChange={(event) => setResolucion(event.target.value)}
            rows={4}
            aria-describedby="resolucion-ayuda"
            style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', padding: '0.5rem' }}
          />
          <p id="resolucion-ayuda">
            Obligatorio para marcarla como completada o rechazada. Es la prueba de que se atendió:
            dentro de un año, esto es lo único que dirá qué se hizo.
          </p>

          <Actions>
            <Button variant="primario" onClick={guardar} disabled={enviando}>
              Guardar
            </Button>
          </Actions>
        </FormCard>
      ) : null}

      <Dialog
        open={dialogoAbierto}
        title="Confirmar la eliminación de datos"
        onClose={() => setDialogoAbierto(false)}
      >
        <p>
          Esta acción es <strong>irreversible</strong>. Confirme que la identidad de la persona
          solicitante está verificada y que procede ejecutarla.
        </p>
        <DialogActions>
          <Button variant="discreto" onClick={() => setDialogoAbierto(false)}>
            Cancelar
          </Button>
          <Button variant="peligro" onClick={ejecutarEliminacion} disabled={enviando}>
            Sí, ejecutar la eliminación
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
