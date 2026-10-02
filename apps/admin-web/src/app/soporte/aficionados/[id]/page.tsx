'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CONSENT_COPY, type ConsentPurpose } from '@mev/domain/browser';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { Dialog, DialogActions } from '@/components/Dialog';
import {
  Button,
  Callout,
  DefinitionList,
  FormCard,
  PageHeader,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

/**
 * Ficha de un aficionado, para atender su caso.
 *
 * Soporte necesita estos datos para hacer su trabajo, y eso es legitimo. Lo que
 * no seria legitimo es verlos sin dejar rastro: la API audita cada consulta de
 * esta ficha, y el aviso de la pantalla lo dice para que quien la abre lo sepa.
 *
 * La referencia de cada prenda llega ENMASCARADA desde la API, incluso para
 * soporte: para atender un caso basta reconocer la prenda.
 */

interface Prenda {
  unitId: string;
  maskedRef: string;
  model: string;
  state: string;
  acquiredVia: string;
  since: string;
}

interface FichaAficionado {
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
  loyaltyTier: number;
  active: boolean;
  anonymized: boolean;
  createdAt: string;
  supportCaseCount: number;
  consents: { purpose: ConsentPurpose; granted: boolean }[];
  jerseys: Prenda[];
}

const VIA_COPY: Record<string, string> = {
  CLAIM: 'Reclamada tras verificar',
  TRANSFER: 'Recibida por transferencia',
  PURCHASE_IMPORT: 'Importada de una compra',
};

export default function FichaPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['fans:read']}>
      <Ficha />
    </GuardedPage>
  );
}

function Ficha(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const { api, permissions } = useSession();
  const id = params?.id ?? null;

  const { data, error, loading, reload } = useApiQuery<FichaAficionado>(
    id ? `/admin/fans/${id}` : null,
  );

  const puedeLiberar = permissions.includes('ownership:write');

  const [aLiberar, setALiberar] = useState<Prenda | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function liberar(): Promise<void> {
    if (!aLiberar) return;
    setFallo(null);
    setAviso(null);
    setEnviando(true);
    try {
      await api.post(`/admin/units/${aLiberar.unitId}/ownership/release`, {
        reason: motivo.trim(),
      });
      setAviso(
        `Titularidad de ${aLiberar.maskedRef} liberada. La prenda vuelve a poder reclamarse.`,
      );
      setALiberar(null);
      setMotivo('');
      reload();
    } catch (cause) {
      setFallo(cause instanceof ApiError ? cause.message : 'Ocurrió un error inesperado.');
    } finally {
      setEnviando(false);
    }
  }

  if (loading && !data) return <p>Cargando la ficha…</p>;

  if (error) {
    return (
      <Callout variant="peligro" title="No se pudo cargar la ficha">
        {error.message}
      </Callout>
    );
  }

  if (!data) {
    return (
      <Callout variant="info" title="Aficionado no encontrado">
        Revise el enlace.
      </Callout>
    );
  }

  return (
    <>
      <PageHeader
        title={data.displayName ?? data.email}
        description={`Cuenta creada el ${formatDateTime(data.createdAt)}`}
      />

      <p>
        <Link href="/soporte/casos">Volver a los casos</Link>
      </p>

      <Callout variant="aviso" title="Esta consulta queda registrada">
        Abrir la ficha de una persona deja una entrada en el registro de auditoría con su usuario.
        Consúltela solo para atender un caso concreto.
      </Callout>

      {data.anonymized ? (
        <Callout variant="info" title="Cuenta anonimizada">
          Esta persona ejerció su derecho de eliminación. Los datos identificativos ya fueron
          destruidos y no pueden recuperarse.
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

      <FormCard title="Datos de la cuenta">
        <DefinitionList
          items={[
            { term: 'Correo', value: data.email },
            { term: 'Nombre', value: data.displayName ?? '—' },
            { term: 'Idioma', value: data.locale },
            { term: 'Nivel de fidelidad', value: String(data.loyaltyTier) },
            { term: 'Cuenta activa', value: data.active ? 'Sí' : 'No' },
            { term: 'Casos abiertos históricamente', value: String(data.supportCaseCount) },
          ]}
        />
      </FormCard>

      <FormCard title="Consentimientos">
        {data.consents.length === 0 ? (
          <p>No ha otorgado ningún consentimiento.</p>
        ) : (
          <DefinitionList
            items={data.consents.map((c) => ({
              term: CONSENT_COPY[c.purpose]?.titulo ?? c.purpose,
              // Sí/No en texto, no solo un color o un icono.
              value: c.granted ? 'Otorgado' : 'No otorgado',
            }))}
          />
        )}
      </FormCard>

      <FormCard title={`Prendas de las que es titular (${data.jerseys.length})`}>
        {data.jerseys.length === 0 ? (
          <p>No tiene prendas registradas a su nombre.</p>
        ) : (
          <table>
            <caption>Prendas con titularidad activa</caption>
            <thead>
              <tr>
                <th scope="col">Referencia</th>
                <th scope="col">Modelo</th>
                <th scope="col">Estado</th>
                <th scope="col">Cómo la obtuvo</th>
                <th scope="col">Desde</th>
                {puedeLiberar ? <th scope="col">Acción</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.jerseys.map((prenda) => (
                <tr key={prenda.unitId}>
                  <th scope="row">{prenda.maskedRef}</th>
                  <td>{prenda.model}</td>
                  <td>{prenda.state}</td>
                  <td>{VIA_COPY[prenda.acquiredVia] ?? prenda.acquiredVia}</td>
                  <td>{formatDateTime(prenda.since)}</td>
                  {puedeLiberar ? (
                    <td>
                      <Button
                        variant="peligro"
                        onClick={() => {
                          setALiberar(prenda);
                          setMotivo('');
                        }}
                      >
                        Liberar titularidad
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </FormCard>

      <Dialog
        open={aLiberar !== null}
        title="Liberar la titularidad"
        onClose={() => setALiberar(null)}
      >
        <p>
          La prenda <strong>{aLiberar?.maskedRef}</strong> dejará de estar registrada a nombre de
          esta persona y volverá a poder reclamarse. Se cancelará cualquier transferencia
          pendiente.
        </p>
        <Callout variant="aviso" title="Se registra a quién se le retira">
          Esta es la operación más propensa a abuso del panel. Queda auditada con su usuario, con
          el motivo y con la persona afectada, para que la decisión sea revisable.
        </Callout>

        <label htmlFor="motivo-liberacion">Motivo (mínimo 10 caracteres)</label>
        <textarea
          id="motivo-liberacion"
          value={motivo}
          onChange={(event) => setMotivo(event.target.value)}
          rows={3}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: '1rem', padding: '0.5rem' }}
        />

        <DialogActions>
          <Button variant="discreto" onClick={() => setALiberar(null)}>
            Cancelar
          </Button>
          <Button
            variant="peligro"
            onClick={() => void liberar()}
            disabled={enviando || motivo.trim().length < 10}
          >
            Liberar titularidad
          </Button>
        </DialogActions>
      </Dialog>

      {!puedeLiberar ? (
        <Callout variant="info" title="Solo lectura">
          Su rol no permite liberar titularidades. Escale el caso si hace falta.
        </Callout>
      ) : null}
    </>
  );
}
