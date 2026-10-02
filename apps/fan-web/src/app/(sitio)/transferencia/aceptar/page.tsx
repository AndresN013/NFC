'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Aviso, Boton, CampoTexto, Cargando, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

function ContenidoAceptar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sesion, cargando: cargandoSesion } = useSesion();

  const tokenDeUrl = searchParams.get('token') ?? '';
  const [token, setToken] = useState(tokenDeUrl);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aceptar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!sesion) return;
    setError(null);
    setEnviando(true);
    try {
      await llamar('/api/v1/fan/transfers/accept', {
        method: 'POST',
        body: { token },
        token: sesion.token,
      });
      router.push('/mis-prendas');
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
        <h1 className="mev-titulo-pagina">Aceptar transferencia</h1>
        <Tarjeta>
          <p style={{ marginTop: 0 }}>
            Necesita una cuenta con el mismo correo al que se dirigio la invitacion.
          </p>
          <div className="mev-fila-acciones">
            <Link href="/cuenta/entrar">Iniciar sesion</Link>
            <Link href="/cuenta/registro">Crear cuenta</Link>
          </div>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Aceptar transferencia</h1>
        <p className="mev-subtitulo">
          Al aceptar, la prenda pasa a estar registrada a su nombre y deja de estarlo a nombre de
          quien se la transfiere.
        </p>
      </div>

      <Tarjeta>
        <form onSubmit={aceptar} noValidate>
          <CampoTexto
            id="token"
            etiqueta="Codigo de invitacion"
            valor={token}
            onChange={setToken}
            requerido
            ayuda="Si abrio el enlace recibido, ya esta rellenado."
          />

          {error ? (
            <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
              <Aviso tono="error" titulo="No se pudo aceptar la transferencia">
                {error}
              </Aviso>
            </div>
          ) : null}

          <Boton type="submit" cargando={enviando} anchoCompleto>
            Aceptar la prenda
          </Boton>
        </form>
      </Tarjeta>

      <Aviso tono="neutro" titulo="Sesion iniciada como">
        {sesion.fan.email}. Si la invitacion se envio a otro correo, tendra que entrar con esa
        cuenta.
      </Aviso>
    </div>
  );
}

export default function PaginaAceptarTransferencia() {
  // `useSearchParams` exige un limite de Suspense en el App Router.
  return (
    <Suspense fallback={<Cargando />}>
      <ContenidoAceptar />
    </Suspense>
  );
}
