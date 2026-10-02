'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Aviso, Boton, CampoTexto, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError } from '@/lib/cliente';
import { guardarSesion, type SesionAficionado } from '@/lib/sesion';

export default function PaginaRegistro() {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [nombre, setNombre] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function registrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const sesion = await llamar<SesionAficionado>('/api/v1/fan/register', {
        method: 'POST',
        body: { email: correo, password: contrasena, displayName: nombre || undefined },
      });
      guardarSesion(sesion);
      router.push('/preferencias');
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Crear cuenta</h1>
        <p className="mev-subtitulo">Opcional. Solo si desea reclamar o transferir prendas.</p>
      </div>

      <Aviso tono="neutro" titulo="Crear cuenta no implica aceptar publicidad">
        Al registrarse no queda suscrito a nada. Los consentimientos de marketing, ubicacion y
        metricas para patrocinadores se gestionan por separado, y todos empiezan desactivados.
      </Aviso>

      <Tarjeta>
        <form onSubmit={registrar} noValidate>
          <CampoTexto
            id="correo"
            etiqueta="Correo electronico"
            tipo="email"
            valor={correo}
            onChange={setCorreo}
            requerido
            autoComplete="email"
          />
          <CampoTexto
            id="nombre"
            etiqueta="Como quiere que le llamemos"
            valor={nombre}
            onChange={setNombre}
            autoComplete="nickname"
            ayuda="Opcional."
          />
          <CampoTexto
            id="contrasena"
            etiqueta="Contrasena"
            tipo="password"
            valor={contrasena}
            onChange={setContrasena}
            requerido
            autoComplete="new-password"
            ayuda="Minimo 12 caracteres. Una frase facil de recordar es mejor que una palabra con simbolos."
          />

          {error ? (
            <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
              <Aviso tono="error" titulo="No pudimos crear la cuenta">
                {error}
              </Aviso>
            </div>
          ) : null}

          <Boton type="submit" cargando={enviando} anchoCompleto>
            Crear cuenta
          </Boton>
        </form>
      </Tarjeta>

      <p>
        Ya tiene cuenta. <Link href="/cuenta/entrar">Iniciar sesion</Link>
      </p>
    </div>
  );
}
