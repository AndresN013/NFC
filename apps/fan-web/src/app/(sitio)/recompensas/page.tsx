'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Aviso, Cargando, EstadoVacio, Insignia, Tarjeta } from '@mev/ui';
import { PRESENTACION_CONFIANZA } from '@mev/ui';
import type { TrustLevel } from '@mev/domain/browser';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

interface Recompensa {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  minTrustLevel: TrustLevel;
  available: boolean;
  alreadyRedeemed: boolean;
}

export default function PaginaRecompensas() {
  const { sesion, cargando: cargandoSesion } = useSesion();
  const [recompensas, setRecompensas] = useState<Recompensa[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion) return;
    llamar<{ rewards: Recompensa[] }>('/api/v1/fan/rewards', { token: sesion.token })
      .then((r) => setRecompensas(r.rewards))
      .catch((e) => setError(mensajeDeError(e)));
  }, [sesion]);

  if (cargandoSesion) return <Cargando />;

  if (!sesion) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Recompensas</h1>
        <Tarjeta>
          <p style={{ marginTop: 0 }}>Necesita iniciar sesion para ver y canjear recompensas.</p>
          <Link href="/cuenta/entrar">Iniciar sesion</Link>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Recompensas</h1>
        <p className="mev-subtitulo">
          Para canjear hay que verificar la prenda en ese momento y ser su titular.
        </p>
      </div>

      {error ? (
        <Aviso tono="error" titulo="No se pudieron cargar las recompensas">
          {error}
        </Aviso>
      ) : null}

      {!recompensas && !error ? <Cargando /> : null}

      {recompensas && recompensas.length === 0 ? (
        <EstadoVacio titulo="No hay recompensas activas ahora mismo" />
      ) : null}

      {recompensas && recompensas.length > 0 ? (
        <ul className="mev-lista-limpia">
          {recompensas.map((r) => {
            const exigeVerificado = r.minTrustLevel === 'VERIFIED';
            return (
              <li key={r.id}>
                <Tarjeta>
                  <div style={{ display: 'flex', gap: 'var(--mev-esp-2)', flexWrap: 'wrap', marginBottom: 'var(--mev-esp-3)' }}>
                    {r.alreadyRedeemed ? <Insignia tono="exito">Ya canjeada</Insignia> : null}
                    {!r.available ? <Insignia tono="alerta">Agotada</Insignia> : null}
                    <Insignia tono="neutro">
                      Requiere: {PRESENTACION_CONFIANZA[r.minTrustLevel].etiqueta}
                    </Insignia>
                  </div>

                  <h2 className="mev-titulo-tarjeta">{r.name}</h2>
                  {r.description ? <p className="mev-contenido-cuerpo">{r.description}</p> : null}

                  {exigeVerificado ? (
                    <div style={{ marginTop: 'var(--mev-esp-3)' }}>
                      {/* Honestidad sobre el estado real del sistema: con los chips
                          del piloto nadie alcanza VERIFIED todavia. */}
                      <Aviso tono="neutro" titulo="Todavia no disponible con su prenda">
                        Esta recompensa exige una comprobacion criptografica del chip. Los escudos
                        del piloto actual no la realizan, por lo que aun no puede canjearse.
                      </Aviso>
                    </div>
                  ) : (
                    <p className="mev-contenido-cuerpo" style={{ marginTop: 'var(--mev-esp-3)' }}>
                      Acerque el telefono al escudo de su prenda y vuelva aqui desde el resultado de
                      la verificacion.
                    </p>
                  )}
                </Tarjeta>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p>
        <Link href="/mis-prendas">Ver mis prendas</Link>
      </p>
    </div>
  );
}
