'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import {
  SUPPORT_CASE_REASON_COPY,
  SUPPORT_CASE_STATE_COPY,
  type SupportCaseState,
} from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import {
  Actions,
  Button,
  Callout,
  DefinitionList,
  FormCard,
  PageHeader,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, orDash } from '@/lib/format';

/**
 * Detalle de un caso de soporte: la pantalla donde el caso se resuelve.
 *
 * Antes de existir, soporte podia ver la lista de casos y nada mas. El motor de
 * riesgo enviaba al aficionado a soporte y ahi terminaba el recorrido.
 *
 * DISTINCION CENTRAL DE ESTA PANTALLA: nota interna frente a respuesta al
 * cliente. Se presentan como dos acciones separadas y con aspecto distinto,
 * nunca como una casilla que se pueda marcar por inercia: una nota interna
 * puede contener una hipotesis sobre una posible falsificacion, y publicarla por
 * error seria acusar a un cliente sin fundamento.
 */

interface Nota {
  id: string;
  body: string;
  visibleToCustomer: boolean;
  author: string;
  createdAt: string;
}

interface CasoDetalle {
  id: string;
  reason: string;
  state: SupportCaseState;
  subject: string;
  description: string;
  contactEmail: string;
  createdAt: string;
  resolvedAt: string | null;
  assignee: { id: string; displayName: string } | null;
  allowedTransitions: SupportCaseState[];
  unit: { id: string; maskedRef: string; state: string; model: string; club: string } | null;
  fan: { id: string; email: string } | null;
  notes: Nota[];
}

export default function CasoPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['support:read']}>
      <Caso />
    </GuardedPage>
  );
}

function Caso(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const { api, permissions } = useSession();
  const casoId = params?.id ?? null;

  const { data, error, loading, reload } = useApiQuery<CasoDetalle>(
    casoId ? `/admin/support-cases/${casoId}` : null,
  );

  const puedeEscribir = permissions.includes('support:write');

  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [notaInterna, setNotaInterna] = useState('');
  const [respuesta, setRespuesta] = useState('');

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

  function cambiarEstado(state: SupportCaseState): void {
    void ejecutar(
      () => api.patch(`/admin/support-cases/${casoId}`, { state }),
      `Caso marcado como ${SUPPORT_CASE_STATE_COPY[state]}.`,
    );
  }

  function guardarNotaInterna(): void {
    const cuerpo = notaInterna.trim();
    if (cuerpo.length < 2) return;
    void ejecutar(async () => {
      // `visibleToCustomer` explícito, aunque el valor por defecto de la API ya
      // sea false: la intención queda escrita en la llamada.
      await api.post(`/admin/support-cases/${casoId}/notes`, {
        body: cuerpo,
        visibleToCustomer: false,
      });
      setNotaInterna('');
    }, 'Nota interna guardada. No es visible para el cliente.');
  }

  function enviarRespuesta(): void {
    const cuerpo = respuesta.trim();
    if (cuerpo.length < 2) return;
    void ejecutar(async () => {
      await api.post(`/admin/support-cases/${casoId}/notes`, {
        body: cuerpo,
        visibleToCustomer: true,
      });
      setRespuesta('');
    }, 'Respuesta enviada. El caso pasa a esperar al cliente.');
  }

  if (loading && !data) return <p>Cargando el caso…</p>;

  if (error) {
    return (
      <Callout variant="peligro" title="No se pudo cargar el caso">
        {error.message}
      </Callout>
    );
  }

  if (!data) return <Callout variant="info" title="Caso no encontrado">Revise el enlace.</Callout>;

  return (
    <>
      <PageHeader
        title={data.subject}
        description={`${SUPPORT_CASE_REASON_COPY[data.reason as keyof typeof SUPPORT_CASE_REASON_COPY] ?? data.reason} · Abierto el ${formatDateTime(data.createdAt)}`}
      />

      <p>
        <Link href="/soporte/casos">Volver a la lista de casos</Link>
      </p>

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

      <FormCard title="Datos del caso">
        <DefinitionList
          items={[
            { term: 'Estado', value: SUPPORT_CASE_STATE_COPY[data.state] ?? data.state },
            { term: 'Correo de contacto', value: data.contactEmail },
            { term: 'Responsable', value: orDash(data.assignee?.displayName) },
            { term: 'Resuelto', value: data.resolvedAt ? formatDateTime(data.resolvedAt) : '—' },
            {
              term: 'Prenda',
              value: data.unit
                ? `${data.unit.club} · ${data.unit.model} · ${data.unit.maskedRef}`
                : 'Sin prenda asociada',
            },
            {
              term: 'Ficha del aficionado',
              value:
                data.fan && permissions.includes('fans:read') ? (
                  <Link href={`/soporte/aficionados/${data.fan.id}`}>Ver ficha</Link>
                ) : (
                  'No disponible'
                ),
            },
          ]}
        />

        <h3>Lo que nos escribió</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{data.description}</p>
      </FormCard>

      {puedeEscribir ? (
        <FormCard title="Cambiar el estado">
          {data.allowedTransitions.length === 0 ? (
            <Callout variant="info" title="Este caso está cerrado">
              Un caso cerrado no se reabre. Si el problema vuelve a ocurrir, abra un caso nuevo:
              así el historial refleja cuántas veces sucedió de verdad.
            </Callout>
          ) : (
            <Actions>
              {data.allowedTransitions.map((state) => (
                <Button
                  key={state}
                  onClick={() => cambiarEstado(state)}
                  disabled={enviando}
                  variant={state === 'CLOSED' ? 'discreto' : 'primario'}
                >
                  {SUPPORT_CASE_STATE_COPY[state] ?? state}
                </Button>
              ))}
            </Actions>
          )}
        </FormCard>
      ) : null}

      {puedeEscribir && data.state !== 'CLOSED' ? (
        <>
          <FormCard title="Responder al cliente">
            <Callout variant="aviso" title="Esto sí lo lee el cliente">
              El texto se mostrará en su página de casos. Al enviarlo, el caso pasa a
              &laquo;Esperando al cliente&raquo;.
            </Callout>
            <label htmlFor="respuesta">Respuesta</label>
            <textarea
              id="respuesta"
              value={respuesta}
              onChange={(event) => setRespuesta(event.target.value)}
              rows={5}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', padding: '0.5rem' }}
            />
            <Actions>
              <Button onClick={enviarRespuesta} disabled={enviando || respuesta.trim().length < 2}>
                Enviar respuesta al cliente
              </Button>
            </Actions>
          </FormCard>

          <FormCard title="Nota interna">
            <Callout variant="info" title="Esto no lo ve el cliente">
              Para hipótesis, comprobaciones pendientes y contexto del equipo.
            </Callout>
            <label htmlFor="nota-interna">Nota</label>
            <textarea
              id="nota-interna"
              value={notaInterna}
              onChange={(event) => setNotaInterna(event.target.value)}
              rows={4}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', padding: '0.5rem' }}
            />
            <Actions>
              <Button
                variant="discreto"
                onClick={guardarNotaInterna}
                disabled={enviando || notaInterna.trim().length < 2}
              >
                Guardar nota interna
              </Button>
            </Actions>
          </FormCard>
        </>
      ) : null}

      <FormCard title={`Historial (${data.notes.length})`}>
        {data.notes.length === 0 ? (
          <p>Todavía no hay notas ni respuestas en este caso.</p>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
            {data.notes.map((nota) => (
              <li
                key={nota.id}
                style={{
                  borderLeft: `4px solid ${nota.visibleToCustomer ? '#0f6b3f' : '#8a8f94'}`,
                  paddingLeft: '0.75rem',
                }}
              >
                {/* El tipo de nota se distingue por texto, no solo por el color
                    del borde: el color por sí solo no es accesible. */}
                <strong>
                  {nota.visibleToCustomer ? 'Respuesta al cliente' : 'Nota interna'}
                </strong>
                <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>{nota.body}</p>
                <small>
                  {nota.author} · {formatDateTime(nota.createdAt)}
                </small>
              </li>
            ))}
          </ol>
        )}
      </FormCard>
    </>
  );
}
