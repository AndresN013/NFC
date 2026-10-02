'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, EstadoVacio, Insignia, Tarjeta, formatearFecha, nombreCondicion, nombreEdicion } from '@mev/ui';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

interface Prenda {
  unitHandle: string;
  maskedRef: string;
  club: string;
  season: string;
  model: string;
  edition: string;
  playerName: string | null;
  shirtNumber: number | null;
  condition: string;
  acquiredVia: string;
  since: string;
}

export default function PaginaMisPrendas() {
  const { sesion, cargando: cargandoSesion, salir } = useSesion();
  const [prendas, setPrendas] = useState<Prenda[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion) return;
    llamar<{ jerseys: Prenda[] }>('/api/v1/fan/jerseys', { token: sesion.token })
      .then((r) => setPrendas(r.jerseys))
      .catch((e) => setError(mensajeDeError(e)));
  }, [sesion]);

  if (cargandoSesion) return <Cargando />;

  if (!sesion) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Mis prendas</h1>
        <Tarjeta>
          <p style={{ marginTop: 0 }}>Necesita iniciar sesion para ver las prendas que ha reclamado.</p>
          <Link href="/cuenta/entrar">Iniciar sesion</Link>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Mis prendas</h1>
        <p className="mev-subtitulo">Sesion de {sesion.fan.displayName ?? sesion.fan.email}</p>
      </div>

      {error ? (
        <Aviso tono="error" titulo="No se pudieron cargar sus prendas">
          {error}
        </Aviso>
      ) : null}

      {!prendas && !error ? <Cargando mensaje="Cargando sus prendas…" /> : null}

      {prendas && prendas.length === 0 ? (
        <EstadoVacio titulo="Todavia no ha reclamado ninguna prenda">
          Acerque su telefono al escudo de su jersey y elija <em>Reclamar esta prenda</em>.
        </EstadoVacio>
      ) : null}

      {prendas && prendas.length > 0 ? (
        <ul className="mev-lista-limpia">
          {prendas.map((p) => (
            <li key={p.unitHandle}>
              <Tarjeta>
                <div style={{ display: 'flex', gap: 'var(--mev-esp-2)', flexWrap: 'wrap', marginBottom: 'var(--mev-esp-3)' }}>
                  <Insignia tono="neutro">{nombreEdicion(p.edition)}</Insignia>
                  <Insignia tono="neutro">{nombreCondicion(p.condition)}</Insignia>
                  {p.shirtNumber != null ? <Insignia tono="neutro">Dorsal {p.shirtNumber}</Insignia> : null}
                </div>

                <h2 className="mev-titulo-tarjeta">
                  {p.club} · {p.model}
                </h2>
                <p className="mev-contenido-cuerpo">
                  {p.season}
                  {p.playerName ? ` · ${p.playerName}` : ''}
                  {' · '}
                  {p.maskedRef}
                </p>
                <p className="mev-contenido-cuerpo">Suya desde {formatearFecha(p.since)}</p>

                <div className="mev-fila-acciones" style={{ marginTop: 'var(--mev-esp-4)' }}>
                  <Link href={`/certificado/${p.unitHandle}`}>Certificado</Link>
                  <Link href={`/mis-prendas/${p.unitHandle}/historial`}>Historial</Link>
                  <Link href={`/transferir/${p.unitHandle}`}>Transferir</Link>
                </div>
              </Tarjeta>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <Boton variante="secundario" onClick={salir}>
          Cerrar sesion
        </Boton>
      </div>
    </div>
  );
}
