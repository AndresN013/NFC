import Link from 'next/link';

/**
 * Navegacion del sitio: portada, cuenta, preferencias, soporte.
 *
 * La pantalla de escaneo no pasa por aqui a proposito.
 */
export default function SitioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mev-sitio">
      <a href="#contenido" className="mev-salto-contenido">
        Saltar al contenido principal
      </a>

      <header className="mev-cabecera">
        <div className="mev-contenedor mev-cabecera__interior">
          <Link href="/" className="mev-marca">
            <span aria-hidden="true" className="mev-marca__glifo" />
            <span>
              Marathon <strong>Escudo Vivo</strong>
            </span>
          </Link>
        </div>
      </header>

      <main id="contenido" className="mev-contenedor mev-principal">
        {children}
      </main>

      <footer className="mev-pie">
        <div className="mev-contenedor">
          <nav aria-label="Enlaces del pie">
            <ul className="mev-pie__enlaces">
              <li>
                <Link href="/preferencias">Preferencias</Link>
              </li>
              <li>
                <Link href="/soporte">Soporte</Link>
              </li>
              <li>
                <Link href="/cuenta/entrar">Iniciar sesion</Link>
              </li>
            </ul>
          </nav>
          <p className="mev-pie__nota">
            Consultar tu camiseta no requiere crear una cuenta ni aceptar publicidad.
          </p>
          <p className="mev-pie__nota">
            Club, escudos y jugadores de demostracion son ficticios.
          </p>
        </div>
      </footer>
    </div>
  );
}
