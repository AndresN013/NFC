'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { useSession } from '@/components/SessionProvider';
import { Button, Callout, Field } from '@/components/ui';
import styles from './entrar.module.css';

export default function EntrarPage(): React.ReactElement {
  const { login, session, ready } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Con sesion valida no hay nada que hacer aqui.
  useEffect(() => {
    if (ready && session) router.replace('/');
  }, [ready, session, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (cause) {
      // La API devuelve el mismo mensaje para usuario inexistente y contrasena
      // incorrecta; el panel no lo desglosa para no confirmar correos validos.
      setError(
        cause instanceof ApiError ? cause.message : 'No se pudo iniciar sesión. Intente de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.pantalla} id="contenido">
      <div className={styles.tarjeta}>
        <h1 className={styles.titulo}>
          Escudo Vivo
          <span className={styles.subtitulo}>Panel administrativo</span>
        </h1>

        <form onSubmit={handleSubmit} className={styles.formulario}>
          <Field label="Correo electrónico">
            {(props) => (
              <input
                {...props}
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>

          <Field label="Contraseña">
            {(props) => (
              <input
                {...props}
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          {/* El error se anuncia sin mover el foco del campo que el usuario tocaba. */}
          <div aria-live="assertive">
            {error ? (
              <Callout variant="peligro" title="No se pudo entrar">
                <p>{error}</p>
              </Callout>
            ) : null}
          </div>

          <Button type="submit" variant="primario" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>

        {/*
          Hueco del segundo factor.
          Reservado para la fase 2: la API ya registra `mfaEnabled` por usuario,
          pero HOY NO SE EXIGE ningun segundo factor en `POST /admin/login`.
          Se deja visible y etiquetado para que nadie asuma que el panel ya pide
          MFA. Ver el comentario en apps/api/src/routes/admin.ts y
          docs/limitaciones.md
        */}
        <section className={styles.mfa} aria-labelledby="mfa-titulo">
          <h2 className={styles.mfaTitulo} id="mfa-titulo">
            Verificación en dos pasos
          </h2>
          <p className={styles.mfaTexto}>
            <strong>No implementada todavía.</strong> Este espacio está reservado para el código de
            segundo factor de la fase 2. Mientras no exista, el acceso al panel depende únicamente
            de la contraseña.
          </p>
          <label className={styles.mfaCampo} htmlFor="mfa-codigo">
            Código de verificación
          </label>
          <input
            id="mfa-codigo"
            name="mfa-codigo"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Disponible en la fase 2"
            disabled
            aria-describedby="mfa-nota"
          />
          <p className={styles.mfaTexto} id="mfa-nota">
            Campo deshabilitado a propósito: no se envía ni se valida.
          </p>
        </section>
      </div>
    </main>
  );
}
