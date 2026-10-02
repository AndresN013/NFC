'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CONSENT_COPY, type ConsentPurpose } from '@mev/domain/browser';
import { Aviso, Boton, Cargando, CampoTexto, Conmutador, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError, useSesion } from '@/lib/cliente';

/**
 * Preferencias y datos personales.
 *
 * Aqui se ejerce todo lo que la LOPDP reconoce: consultar consentimientos,
 * otorgarlos, revocarlos y pedir acceso o eliminacion.
 *
 * La lista de finalidades y sus textos vienen de `@mev/domain` (CONSENT_COPY),
 * no se reescriben aqui: si cambia la finalidad, cambia en un solo sitio.
 */

interface RespuestaConsentimientos {
  policyVersion: string;
  consents: { purpose: ConsentPurpose; granted: boolean; updatedAt: string | null }[];
}

const TIPOS_SOLICITUD = [
  { valor: 'ACCESS', etiqueta: 'Acceso: quiero saber que datos tienen sobre mi' },
  { valor: 'RECTIFICATION', etiqueta: 'Rectificacion: hay un dato incorrecto' },
  { valor: 'DELETION', etiqueta: 'Eliminacion: quiero que borren mis datos' },
  { valor: 'OPPOSITION', etiqueta: 'Oposicion: no quiero que traten mis datos' },
  { valor: 'PORTABILITY', etiqueta: 'Portabilidad: quiero una copia de mis datos' },
  { valor: 'CONSENT_WITHDRAWAL', etiqueta: 'Retiro de consentimiento' },
] as const;

export default function PaginaPreferencias() {
  const { sesion, cargando: cargandoSesion } = useSesion();
  const [datos, setDatos] = useState<RespuestaConsentimientos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    setCargando(true);
    setError(null);
    try {
      setDatos(
        await llamar<RespuestaConsentimientos>('/api/v1/fan/consents', { token: sesion.token }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [sesion]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiar(purpose: ConsentPurpose, granted: boolean): Promise<void> {
    if (!sesion) return;
    setError(null);
    setGuardado(null);
    // Actualizacion optimista: el conmutador responde de inmediato y se corrige
    // si el servidor rechaza el cambio.
    setDatos((actual) =>
      actual
        ? {
            ...actual,
            consents: actual.consents.map((c) => (c.purpose === purpose ? { ...c, granted } : c)),
          }
        : actual,
    );
    try {
      await llamar('/api/v1/fan/consents', {
        method: 'PUT',
        body: { purpose, granted },
        token: sesion.token,
      });
      setGuardado(
        granted
          ? `Consentimiento otorgado: ${CONSENT_COPY[purpose].titulo}`
          : `Consentimiento revocado: ${CONSENT_COPY[purpose].titulo}`,
      );
    } catch (e) {
      setError(mensajeDeError(e));
      void cargar();
    }
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Preferencias y datos personales</h1>
        <p className="mev-subtitulo">
          Verificar su jersey, ver su certificado y abrir un caso de soporte funcionan siempre, sin
          depender de ninguna de estas opciones.
        </p>
      </div>

      {cargandoSesion ? <Cargando /> : null}

      {!cargandoSesion && !sesion ? (
        <Tarjeta titulo="Consentimientos">
          <p style={{ marginTop: 0 }}>
            Para consultar y cambiar sus consentimientos necesita iniciar sesion, porque estan
            asociados a su cuenta.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/cuenta/entrar">Iniciar sesion</Link>
          </p>
        </Tarjeta>
      ) : null}

      {sesion ? (
        <Tarjeta titulo="Consentimientos">
          {cargando && !datos ? <Cargando mensaje="Cargando sus consentimientos…" /> : null}

          {guardado ? (
            <div role="status" aria-live="polite" style={{ marginBottom: 'var(--mev-esp-4)' }}>
              <Aviso tono="exito">{guardado}</Aviso>
            </div>
          ) : null}

          {error ? (
            <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
              <Aviso tono="error" titulo="No se pudo guardar">
                {error}
              </Aviso>
            </div>
          ) : null}

          {datos
            ? datos.consents.map((c) => (
                <Conmutador
                  key={c.purpose}
                  id={`consent-${c.purpose}`}
                  etiqueta={CONSENT_COPY[c.purpose].titulo}
                  descripcion={CONSENT_COPY[c.purpose].descripcion}
                  activo={c.granted}
                  onChange={(valor) => void cambiar(c.purpose, valor)}
                />
              ))
            : null}

          {datos ? (
            <p style={{ marginTop: 'var(--mev-esp-4)', fontSize: 'var(--mev-texto-xs)', color: 'var(--mev-tinta-suave)' }}>
              Version del texto informativo vigente: {datos.policyVersion}
            </p>
          ) : null}
        </Tarjeta>
      ) : null}

      <SolicitudPrivacidad correoPredeterminado={sesion?.fan.email ?? ''} />

      <Aviso tono="neutro" titulo="Que hacemos con su ubicacion">
        Nunca guardamos su ubicacion exacta. Para detectar usos anomalos usamos unicamente el pais
        aproximado, derivado de una direccion IP que almacenamos truncada y seudonimizada.
      </Aviso>
    </div>
  );
}

function SolicitudPrivacidad({ correoPredeterminado }: { correoPredeterminado: string }) {
  const [correo, setCorreo] = useState(correoPredeterminado);
  const [tipo, setTipo] = useState<string>('ACCESS');
  const [detalles, setDetalles] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ requestId: string; dueAt: string } | null>(null);

  useEffect(() => {
    if (correoPredeterminado) setCorreo(correoPredeterminado);
  }, [correoPredeterminado]);

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      setResultado(
        await llamar<{ requestId: string; dueAt: string }>('/api/v1/privacy/requests', {
          method: 'POST',
          body: { email: correo, type: tipo, details: detalles || undefined },
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <Tarjeta titulo="Solicitud sobre sus datos">
        <Aviso tono="exito" titulo="Solicitud registrada">
          Referencia: <code>{resultado.requestId.slice(0, 8)}</code>. Le responderemos antes del{' '}
          {new Date(resultado.dueAt).toLocaleDateString('es-EC')}. Podemos pedirle verificar su
          identidad antes de entregar informacion.
        </Aviso>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Solicitud sobre sus datos">
      <p style={{ marginTop: 0, fontSize: 'var(--mev-texto-sm)', color: 'var(--mev-tinta-suave)' }}>
        Puede ejercer sus derechos aunque no tenga cuenta.
      </p>

      <form onSubmit={enviar} noValidate>
        <CampoTexto
          id="privacidad-correo"
          etiqueta="Correo electronico"
          tipo="email"
          valor={correo}
          onChange={setCorreo}
          requerido
          autoComplete="email"
        />

        <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
          <label
            htmlFor="privacidad-tipo"
            style={{
              display: 'block',
              marginBottom: 'var(--mev-esp-2)',
              fontSize: 'var(--mev-texto-sm)',
              fontWeight: 600,
            }}
          >
            Que desea solicitar
          </label>
          <select
            id="privacidad-tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            style={{
              width: '100%',
              minHeight: '2.75rem',
              padding: 'var(--mev-esp-3)',
              borderRadius: 'var(--mev-radio-sm)',
              border: '2px solid var(--mev-linea)',
              background: 'var(--mev-fondo)',
              color: 'var(--mev-tinta)',
              fontSize: 'var(--mev-texto-md)',
              fontFamily: 'inherit',
            }}
          >
            {TIPOS_SOLICITUD.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <CampoTexto
          id="privacidad-detalles"
          etiqueta="Detalles"
          valor={detalles}
          onChange={setDetalles}
          multilinea
          ayuda="Opcional."
        />

        {error ? (
          <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
            <Aviso tono="error" titulo="No se pudo enviar">
              {error}
            </Aviso>
          </div>
        ) : null}

        <Boton type="submit" variante="secundario" cargando={enviando} anchoCompleto>
          Enviar solicitud
        </Boton>
      </form>
    </Tarjeta>
  );
}
