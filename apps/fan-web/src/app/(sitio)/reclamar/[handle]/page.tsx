'use client';

import Link from 'next/link';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Aviso, Boton, Cargando, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

/**
 * Reclamar la titularidad de una prenda.
 *
 * Requiere la referencia del evento de verificacion (`?evento=`) que genero la
 * lectura. La API comprueba que sea reciente y de ESTA prenda: sin ese control,
 * conocer un identificador filtrado bastaria para reclamar prendas ajenas.
 */

export default function PaginaReclamar() {
  const router = useRouter();
  const params = useParams<{ handle: string }>();
  const searchParams = useSearchParams();
  const { sesion, cargando: cargandoSesion } = useSesion();

  const eventoRef = searchParams.get('evento');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reclamar(): Promise<void> {
    if (!sesion || !params?.handle || !eventoRef) return;
    setError(null);
    setEnviando(true);
    try {
      await llamar('/api/v1/fan/claims', {
        method: 'POST',
        body: { unitHandle: params.handle, eventRef: eventoRef },
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

  if (!eventoRef) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Reclamar prenda</h1>
        <Aviso tono="alerta" titulo="Falta la verificacion">
          Para reclamar una prenda hay que verificarla primero. Acerque su telefono al escudo y
          elija <em>Reclamar esta prenda</em> en el resultado.
        </Aviso>
      </div>
    );
  }

  if (!sesion) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Reclamar prenda</h1>
        <Tarjeta>
          <p style={{ marginTop: 0 }}>
            Necesita una cuenta para registrar la titularidad. Es el unico paso del proceso que la
            requiere.
          </p>
          <div className="mev-fila-acciones">
            <Link href="/cuenta/entrar">Iniciar sesion</Link>
            <Link href="/cuenta/registro">Crear cuenta</Link>
          </div>
          <Aviso tono="neutro" titulo="Tenga en cuenta">
            La verificacion caduca a los 30 minutos. Si tarda mas, vuelva a acercar el telefono al
            escudo.
          </Aviso>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Reclamar esta prenda</h1>
        <p className="mev-subtitulo">
          Quedara registrada como suya. Podra transferirla mas adelante si la regala o la vende.
        </p>
      </div>

      <Tarjeta>
        {error ? (
          <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
            <Aviso tono="error" titulo="No se pudo reclamar">
              {error}
            </Aviso>
          </div>
        ) : null}

        <Boton onClick={() => void reclamar()} cargando={enviando} anchoCompleto>
          Confirmar el reclamo
        </Boton>
      </Tarjeta>

      <Aviso tono="neutro" titulo="Que registramos">
        Guardamos que su cuenta es titular de esta prenda y desde cuando. No guardamos donde estaba
        al reclamarla.
      </Aviso>
    </div>
  );
}
