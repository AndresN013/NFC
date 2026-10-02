'use client';

import { useEffect, useState } from 'react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useSession } from '@/components/SessionProvider';
import { GuardedPage } from '@/components/GuardedPage';
import { Button, Callout, FormCard, PageHeader, SelectFilter } from '@/components/ui';
import { ApiError } from '@/lib/api-client';

/**
 * Preparar una camiseta y grabar su chip desde el telefono.
 *
 * Esta pantalla esta pensada para usarse EN el telefono que va a grabar, con una
 * mano y de pie. De ahi que la URL se copie con un boton y no haya que teclear
 * nada: el identificador tiene 43 caracteres y escribirlo a mano garantiza
 * errores.
 */

interface Direccion {
  etiqueta: string;
  base: string;
  nota: string;
}

interface Direcciones {
  direcciones: Direccion[];
  advertencia: string | null;
}

interface Modelo {
  id: string;
  name: string;
  skus: { code: string; size: string }[];
  club: { name: string };
}

interface Jugador {
  id: string;
  fullName: string;
  shirtNumber: number | null;
}

interface Preparada {
  unitId: string;
  publicRef: string;
  tagUrl: string;
  qrUrl: string;
  bytes: { required: number; available: number };
}

export default function ProgramarPage(): React.ReactElement {
  return (
    <GuardedPage permissions={['production:activate']}>
      <Programar />
    </GuardedPage>
  );
}

function Programar(): React.ReactElement {
  const { api } = useSession();

  const { data: red } = useApiQuery<Direcciones>('/admin/tags/direcciones');
  const { data: modelos } = useApiQuery<{ items: Modelo[] }>('/admin/jersey-models');
  const { data: jugadores } = useApiQuery<{ items: Jugador[] }>('/admin/players');

  const [base, setBase] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [preparada, setPreparada] = useState<Preparada | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Se preselecciona la primera direccion de red: es la correcta en el 90 % de
  // los casos y evita que alguien elija localhost sin darse cuenta.
  useEffect(() => {
    if (!base && red?.direcciones.length) setBase(red.direcciones[0]!.base);
  }, [red, base]);

  const skus = (modelos?.items ?? []).flatMap((m) =>
    m.skus.map((s) => ({
      value: s.code,
      label: `${m.club.name} · ${m.name} · talla ${s.size}`,
    })),
  );

  async function preparar(): Promise<void> {
    setFallo(null);
    setCopiado(false);
    setEnviando(true);
    try {
      const jugador = (jugadores?.items ?? []).find((j) => j.id === playerId);
      setPreparada(
        await api.post<Preparada>('/admin/tags/provision', {
          skuCode,
          baseUrl: base,
          playerId: playerId || undefined,
          shirtNumber: jugador?.shirtNumber ?? undefined,
        }),
      );
    } catch (cause) {
      setFallo(cause instanceof ApiError ? cause.message : 'Ocurrió un error inesperado.');
    } finally {
      setEnviando(false);
    }
  }

  async function copiar(texto: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS): se avisa en vez de fallar en
      // silencio, porque el operario necesita la URL sí o sí.
      setFallo(
        'El navegador no dejó copiar automáticamente. Mantén pulsado el texto de arriba para copiarlo a mano.',
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Grabar un chip NFC"
        description="Prepara una camiseta y graba su chip con una app de escritura NFC."
      />

      {red?.advertencia ? (
        <Callout variant="peligro" title="Revisa la dirección antes de grabar">
          {red.advertencia}
        </Callout>
      ) : null}

      {preparada ? (
        <>
          <Callout variant="aviso" title="Copia esto ahora">
            Esta dirección se muestra <strong>una sola vez</strong>. Si la pierdes, prepara otra
            camiseta.
          </Callout>

          <FormCard title="1. Copia la dirección">
            <p
              style={{
                wordBreak: 'break-all',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.95rem',
                background: '#f3f5f7',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                userSelect: 'all',
              }}
            >
              {preparada.tagUrl}
            </p>
            <Button variant="primario" onClick={() => void copiar(preparada.tagUrl)}>
              {copiado ? '✓ Copiada' : 'Copiar dirección'}
            </Button>
            <p style={{ fontSize: '0.8rem', color: '#47535e' }}>
              Ocupa {preparada.bytes.required} de los {preparada.bytes.available} bytes del chip.
            </p>
          </FormCard>

          <FormCard title="2. Grábala en el chip">
            <ol style={{ paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
              <li>
                Abre una app de escritura NFC (por ejemplo <strong>NFC Tools</strong>, gratuita en
                Android y iPhone).
              </li>
              <li>
                Entra en <strong>Escribir</strong> → <strong>Añadir un registro</strong> →{' '}
                <strong>URL / Dirección web</strong>.
              </li>
              <li>Pega la dirección que acabas de copiar.</li>
              <li>
                Pulsa <strong>Escribir</strong> y apoya el teléfono sobre el escudo, sin moverlo,
                hasta que confirme.
              </li>
            </ol>
            <Callout variant="info" title="No bloquees el chip todavía">
              Algunas apps ofrecen &laquo;proteger contra escritura&raquo;. En pruebas no lo uses:
              es irreversible y te deja el chip inservible si algo sale mal.
            </Callout>
          </FormCard>

          <FormCard title="3. Compruébalo">
            <p style={{ marginTop: 0 }}>
              Aparta el teléfono, vuelve a acercarlo al escudo y debería abrirse la página de la
              camiseta <strong>{preparada.publicRef}</strong>.
            </p>
            <Button variant="discreto" onClick={() => setPreparada(null)}>
              Preparar otra camiseta
            </Button>
          </FormCard>

          {fallo ? (
            <Callout variant="peligro" title="Atención">
              {fallo}
            </Callout>
          ) : null}
        </>
      ) : (
        <FormCard title="Preparar una camiseta">
          <SelectFilter
            label="Dirección que abrirá el aficionado"
            value={base}
            onChange={setBase}
            options={(red?.direcciones ?? []).map((d) => ({
              value: d.base,
              label: `${d.base} — ${d.etiqueta}`,
            }))}
            allLabel="Elige una dirección"
          />
          <p style={{ fontSize: '0.8rem', color: '#47535e', marginTop: '-0.5rem' }}>
            Tiene que ser una dirección que el teléfono del aficionado pueda abrir. En pruebas, la
            de tu red WiFi.
          </p>

          <SelectFilter
            label="Modelo y talla"
            value={skuCode}
            onChange={setSkuCode}
            options={skus}
            allLabel="Elige un modelo"
          />

          <SelectFilter
            label="Jugador (opcional)"
            value={playerId}
            onChange={setPlayerId}
            options={(jugadores?.items ?? []).map((j) => ({
              value: j.id,
              label: j.shirtNumber != null ? `${j.shirtNumber} · ${j.fullName}` : j.fullName,
            }))}
            allLabel="Sin jugador"
          />

          {fallo ? (
            <Callout variant="peligro" title="No se pudo preparar">
              {fallo}
            </Callout>
          ) : null}

          <Button
            variant="primario"
            onClick={() => void preparar()}
            disabled={enviando || !skuCode || !base}
          >
            {enviando ? 'Preparando…' : 'Preparar y obtener la dirección'}
          </Button>
        </FormCard>
      )}
    </>
  );
}
