'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Aviso, Boton, CampoTexto, Tarjeta } from '@mev/ui';
import { llamar, mensajeDeError } from '@/lib/cliente';
import { guardarSesion, type SesionAficionado } from '@/lib/sesion';

export default function PaginaEntrar() {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const sesion = await llamar<SesionAficionado>('/api/v1/fan/login', {
        method: 'POST',
        body: { email: correo, password: contrasena },
      });
      guardarSesion(sesion);
      router.push('/mis-prendas');
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Iniciar sesion</h1>
        <p className="mev-subtitulo">
          La cuenta es opcional. Sirve para reclamar y transferir prendas, y para acceder a
          recompensas. Verificar un jersey no la requiere.
        </p>
      </div>

      <Tarjeta>
        <form onSubmit={entrar} noValidate>
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
            id="contrasena"
            etiqueta="Contrasena"
            tipo="password"
            valor={contrasena}
            onChange={setContrasena}
            requerido
            autoComplete="current-password"
          />

          {error ? (
            <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
              {/* Mensaje deliberadamente generico: no revela si el correo existe. */}
              <Aviso tono="error" titulo="No pudimos iniciar sesion">
                {error}
              </Aviso>
            </div>
          ) : null}

          <Boton type="submit" cargando={enviando} anchoCompleto>
            Entrar
          </Boton>
        </form>
      </Tarjeta>

      <p>
        No tiene cuenta. <Link href="/cuenta/registro">Crear una cuenta</Link>
      </p>
    </div>
  );
}
