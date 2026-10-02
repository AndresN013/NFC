'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Aviso, Cargando, Insignia, ListaDefiniciones, Tarjeta, formatearFecha, nombreCondicion } from '@mev/ui';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

/**
 * Historial permitido de la prenda.
 *
 * La API ya decide que es "permitido": devuelve cuantas veces cambio de manos y
 * en que mes, pero NUNCA quien fue el propietario anterior. Esta pagina no
 * intenta enriquecer esa informacion.
 */

interface Historial {
  activatedAt: string | null;
  interactionCount: number;
  condition: string;
  ownerCount: number;
  timeline: { position: number; isYou: boolean; acquiredVia: string; from: string; to: string | null }[];
}

const VIAS: Record<string, string> = {
  CLAIM: 'Reclamada tras verificar la prenda',
  TRANSFER: 'Recibida por transferencia',
  PURCHASE_IMPORT: 'Registrada a partir de una compra',
};

export default function PaginaHistorial() {
  const params = useParams<{ handle: string }>();
  const { sesion, cargando: cargandoSesion } = useSesion();
  const [historial, setHistorial] = useState<Historial | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion || !params?.handle) return;
    llamar<Historial>(`/api/v1/fan/jerseys/${params.handle}/history`, { token: sesion.token })
      .then(setHistorial)
      .catch((e) => setError(mensajeDeError(e)));
  }, [sesion, params?.handle]);

  if (cargandoSesion) return <Cargando />;

  if (!sesion) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Historial de la prenda</h1>
        <Tarjeta>
          <p style={{ marginTop: 0 }}>Solo el titular puede consultar el historial.</p>
          <Link href="/cuenta/entrar">Iniciar sesion</Link>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Historial de la prenda</h1>
        <p className="mev-subtitulo">
          Por respeto a la privacidad de otras personas, no mostramos quien tuvo la prenda antes.
        </p>
      </div>

      {error ? (
        <Aviso tono="error" titulo="No se pudo cargar el historial">
          {error}
        </Aviso>
      ) : null}

      {!historial && !error ? <Cargando /> : null}

      {historial ? (
        <>
          <Tarjeta titulo="Resumen">
            <ListaDefiniciones
              datos={[
                { termino: 'Activada', valor: formatearFecha(historial.activatedAt) ?? 'No disponible' },
                { termino: 'Estado', valor: nombreCondicion(historial.condition) },
                { termino: 'Titulares registrados', valor: String(historial.ownerCount) },
                { termino: 'Interacciones', valor: String(historial.interactionCount) },
              ]}
            />
          </Tarjeta>

          <Tarjeta titulo="Cambios de titularidad">
            <ol style={{ paddingLeft: '1.25rem', margin: 0, display: 'grid', gap: 'var(--mev-esp-4)' }}>
              {historial.timeline.map((t) => (
                <li key={t.position}>
                  <div style={{ marginBottom: 'var(--mev-esp-2)' }}>
                    <Insignia tono={t.isYou ? 'exito' : 'neutro'}>
                      {t.isYou ? 'Usted' : 'Titular anterior'}
                    </Insignia>
                  </div>
                  <p style={{ margin: 0, fontSize: 'var(--mev-texto-sm)' }}>
                    {VIAS[t.acquiredVia] ?? t.acquiredVia}
                  </p>
                  <p
                    style={{
                      margin: 'var(--mev-esp-1) 0 0',
                      fontSize: 'var(--mev-texto-xs)',
                      color: 'var(--mev-tinta-suave)',
                    }}
                  >
                    Desde {t.from}
                    {t.to ? ` hasta ${t.to}` : ' (actual)'}
                  </p>
                </li>
              ))}
            </ol>
          </Tarjeta>
        </>
      ) : null}
    </div>
  );
}
