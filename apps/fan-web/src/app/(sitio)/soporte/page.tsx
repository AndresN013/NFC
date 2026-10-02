'use client';

import { useState } from 'react';
import { Aviso, Boton, CampoTexto, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError } from '@/lib/cliente';

/**
 * Soporte y garantia.
 *
 * NO requiere cuenta a proposito: alguien que duda de la autenticidad de su
 * prenda debe poder escribirnos sin registrarse antes.
 */

const MOTIVOS = [
  { valor: 'AUTHENTICITY_DOUBT', etiqueta: 'Tengo dudas sobre la autenticidad de mi prenda' },
  { valor: 'NFC_NOT_READING', etiqueta: 'El escudo no responde a mi telefono' },
  { valor: 'WARRANTY', etiqueta: 'Quiero usar la garantia' },
  { valor: 'TRANSFER_ISSUE', etiqueta: 'Problema con una transferencia de titularidad' },
  { valor: 'OTHER', etiqueta: 'Otro motivo' },
] as const;

export default function PaginaSoporte() {
  const [correo, setCorreo] = useState('');
  const [motivo, setMotivo] = useState<string>('AUTHENTICITY_DOUBT');
  const [asunto, setAsunto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caso, setCaso] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const respuesta = await llamar<{ caseId: string; message: string }>(
        '/api/v1/support/cases',
        {
          method: 'POST',
          body: { contactEmail: correo, reason: motivo, subject: asunto, description: descripcion },
        },
      );
      setCaso(respuesta.caseId);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  if (caso) {
    return (
      <div className="mev-pila">
        <h1 className="mev-titulo-pagina">Solicitud recibida</h1>
        <Aviso tono="exito" titulo="Le responderemos al correo indicado">
          Guarde esta referencia de su caso: <code>{caso.slice(0, 8)}</code>
        </Aviso>
      </div>
    );
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Soporte y garantia</h1>
        <p className="mev-subtitulo">
          No necesita tener una cuenta para escribirnos.
        </p>
      </div>

      <Tarjeta>
        <form onSubmit={enviar} noValidate>
          <CampoTexto
            id="correo"
            etiqueta="Su correo electronico"
            tipo="email"
            valor={correo}
            onChange={setCorreo}
            requerido
            autoComplete="email"
            ayuda="Solo lo usamos para responderle este caso."
          />

          <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
            <label
              htmlFor="motivo"
              style={{
                display: 'block',
                marginBottom: 'var(--mev-esp-2)',
                fontSize: 'var(--mev-texto-sm)',
                fontWeight: 600,
              }}
            >
              Motivo{' '}
              <span aria-hidden="true" style={{ color: 'var(--mev-error)' }}>
                *
              </span>
              <span className="mev-solo-lectores"> (obligatorio)</span>
            </label>
            <select
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              required
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
              {MOTIVOS.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.etiqueta}
                </option>
              ))}
            </select>
          </div>

          <CampoTexto
            id="asunto"
            etiqueta="Asunto"
            valor={asunto}
            onChange={setAsunto}
            requerido
          />

          <CampoTexto
            id="descripcion"
            etiqueta="Cuentenos que ocurre"
            valor={descripcion}
            onChange={setDescripcion}
            requerido
            multilinea
            ayuda="Minimo 10 caracteres. Incluya donde compro la prenda si su duda es sobre autenticidad."
          />

          {error ? (
            <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
              <Aviso tono="error" titulo="No se pudo enviar">
                {error}
              </Aviso>
            </div>
          ) : null}

          <Boton type="submit" cargando={enviando} anchoCompleto>
            Enviar solicitud
          </Boton>
        </form>
      </Tarjeta>

      <Aviso tono="neutro" titulo="Sobre sus datos">
        Usamos su correo unicamente para atender este caso. Puede solicitar el acceso o la
        eliminacion de sus datos desde la pagina de preferencias.
      </Aviso>
    </div>
  );
}
