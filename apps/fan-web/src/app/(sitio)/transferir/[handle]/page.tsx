'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Aviso, Boton, CampoTexto, Cargando, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

/**
 * Iniciar una transferencia de titularidad.
 *
 * El token de invitacion se muestra UNA sola vez. No vuelve a estar disponible:
 * la base de datos guarda solo su hash.
 */

interface RespuestaTransferencia {
  transferId: string;
  expiresAt: string;
  invitationToken: string;
  message: string;
}

export default function PaginaTransferir() {
  const params = useParams<{ handle: string }>();
  const { sesion, cargando: cargandoSesion } = useSesion();

  const [correo, setCorreo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RespuestaTransferencia | null>(null);

  async function iniciar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!sesion || !params?.handle) return;
    setError(null);
    setEnviando(true);
    try {
      setResultado(
        await llamar<RespuestaTransferencia>('/api/v1/fan/transfers', {
          method: 'POST',
          body: { unitHandle: params.handle, toEmail: correo },
          token: sesion.token,
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  if (cargandoSesion) return <Cargando />;

  if (!sesion) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Transferir prenda</h1>
        <Tarjeta>
          <p style={{ marginTop: 0 }}>Solo el titular puede transferir una prenda.</p>
          <Link href="/cuenta/entrar">Iniciar sesion</Link>
        </Tarjeta>
      </div>
    );
  }

  if (resultado) {
    const enlace =
      typeof window !== 'undefined'
        ? `${window.location.origin}/transferencia/aceptar?token=${encodeURIComponent(resultado.invitationToken)}`
        : '';

    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Invitacion generada</h1>

        <Aviso tono="alerta" titulo="Copie este enlace ahora">
          Este enlace se muestra una unica vez y no podremos volver a mostrarlo. Si lo pierde,
          cancele la transferencia y genere una nueva.
        </Aviso>

        <Tarjeta titulo="Enlace de transferencia">
          <p
            style={{
              wordBreak: 'break-all',
              background: 'var(--mev-fondo-suave)',
              padding: 'var(--mev-esp-3)',
              borderRadius: 'var(--mev-radio-sm)',
              fontSize: 'var(--mev-texto-sm)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {enlace}
          </p>
          <p className="mev-contenido-cuerpo">{resultado.message}</p>
          <p className="mev-contenido-cuerpo">
            Solo la persona con el correo <strong>{correo}</strong> podra aceptarla.
          </p>
        </Tarjeta>

        <p>
          <Link href="/mis-prendas">Volver a mis prendas</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Transferir prenda</h1>
        <p className="mev-subtitulo">
          Genere una invitacion para que otra persona registre la prenda a su nombre.
        </p>
      </div>

      <Tarjeta>
        <form onSubmit={iniciar} noValidate>
          <CampoTexto
            id="destino"
            etiqueta="Correo de la persona destinataria"
            tipo="email"
            valor={correo}
            onChange={setCorreo}
            requerido
            autoComplete="off"
            ayuda="Solo esa cuenta podra aceptar la transferencia. La invitacion caduca en 7 dias."
          />

          {error ? (
            <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
              <Aviso tono="error" titulo="No se pudo iniciar la transferencia">
                {error}
              </Aviso>
            </div>
          ) : null}

          <Boton type="submit" cargando={enviando} anchoCompleto>
            Generar invitacion
          </Boton>
        </form>
      </Tarjeta>

      <Aviso tono="neutro" titulo="Que vera la otra persona">
        Vera el club, la temporada y el modelo de la prenda. No vera su nombre, su correo ni desde
        donde verifico usted el jersey.
      </Aviso>
    </div>
  );
}
