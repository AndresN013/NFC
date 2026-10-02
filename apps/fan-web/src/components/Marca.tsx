import estilos from './marca.module.css';

/**
 * Identidad corporativa de Marathon.
 *
 * SOBRE EL LOGOTIPO
 * -----------------
 * Mientras no exista el archivo oficial, la marca se compone TIPOGRAFICAMENTE
 * con texto real. Es una aproximacion deliberada, no una copia del logotipo:
 *
 *  - Se lee con lector de pantalla y se puede seleccionar.
 *  - Escala con el zoom del sistema sin pixelarse.
 *  - No pesa nada ni anade una peticion de red.
 *
 * Para usar el logotipo oficial: deja el SVG en `public/marca/marathon.svg` y
 * sustituye el `<span>` de `LogoMarathon` por una `<img>` con `alt="Marathon"`.
 * Los colores de `marca.module.css` tambien son una aproximacion tomada de
 * marathon.store y deben reemplazarse por los del manual de marca.
 */

type Tamano = 'barra' | 'grande' | 'sello';

const CLASES: Record<Tamano, string> = {
  barra: estilos.logoBarra!,
  grande: estilos.logoGrande!,
  sello: estilos.selloLogo!,
};

export function LogoMarathon({ tamano = 'barra' }: { tamano?: Tamano }) {
  // `aria-label` en lugar del texto suelto: para una tecnologia asistiva esto es
  // el nombre de la marca, no una palabra en minusculas dentro de una frase.
  return (
    <span className={CLASES[tamano]} role="img" aria-label="Marathon">
      marathon
    </span>
  );
}

/** Franja superior de marca. Lo primero que se ve al abrir el escudo. */
export function BarraMarathon({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className={`${estilos.barra} ${compacta ? estilos.barraCompacta : ''}`}>
      <LogoMarathon tamano="barra" />
    </div>
  );
}

/**
 * Sello de respaldo.
 *
 * Va DEBAJO del veredicto a proposito: el aficionado primero se entera de que su
 * camiseta esta bien, y despues de quien lo respalda.
 */
export function SelloMarathon() {
  return (
    <div className={estilos.sello}>
      <LogoMarathon tamano="sello" />
      <span className={estilos.selloTexto}>
        Registro oficial de autenticidad
      </span>
    </div>
  );
}

/** Cierre de la pantalla, con el aviso de que el club es ficticio. */
export function PieMarathon() {
  return (
    <div className={estilos.pieMarca}>
      <LogoMarathon tamano="barra" />
      <p className={estilos.pieMarcaNota}>
        El club, los jugadores y los escudos de esta demostracion son ficticios.
      </p>
    </div>
  );
}
