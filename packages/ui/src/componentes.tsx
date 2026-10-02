import type { CSSProperties, ReactNode } from 'react';
import type { TrustLevel } from '@mev/domain/browser';
import { PRESENTACION_CONFIANZA } from './presentacion-confianza';

/**
 * Biblioteca de componentes accesibles compartida.
 *
 * Sin dependencias externas: React y CSS. Todos los colores salen de las
 * variables de `tokens.css`, de modo que el tema claro/oscuro funciona sin
 * duplicar componentes.
 */

const TONO_A_VARIABLES: Record<string, { texto: string; fondo: string }> = {
  exito: { texto: 'var(--mev-exito)', fondo: 'var(--mev-exito-fondo)' },
  neutro: { texto: 'var(--mev-neutro)', fondo: 'var(--mev-neutro-fondo)' },
  alerta: { texto: 'var(--mev-alerta)', fondo: 'var(--mev-alerta-fondo)' },
  error: { texto: 'var(--mev-error)', fondo: 'var(--mev-error-fondo)' },
};

// --- Nivel de confianza -----------------------------------------------------

export interface NivelDeConfianzaProps {
  nivel: TrustLevel;
  /** Marca de simulacion: se muestra un aviso adicional cuando es true. */
  simulado?: boolean;
  children?: ReactNode;
}

/**
 * Presenta el resultado de una verificacion.
 *
 * El significado viaja por TRES canales independientes: color, glifo y texto.
 * Quitar el color no elimina la informacion.
 */
export function NivelDeConfianza({ nivel, simulado, children }: NivelDeConfianzaProps) {
  const p = PRESENTACION_CONFIANZA[nivel];
  const colores = TONO_A_VARIABLES[p.tono]!;

  return (
    <section
      aria-labelledby="mev-titulo-confianza"
      // `assertive` solo en los estados que exigen atencion inmediata.
      aria-live={p.urgencia}
      style={{
        background: colores.fondo,
        border: `2px solid ${colores.texto}`,
        borderRadius: 'var(--mev-radio)',
        padding: 'var(--mev-esp-5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--mev-esp-3)' }}>
        <span
          aria-hidden="true"
          style={{
            flex: '0 0 auto',
            width: '2.5rem',
            height: '2.5rem',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            border: `2px solid ${colores.texto}`,
            color: colores.texto,
            fontSize: 'var(--mev-texto-lg)',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {p.glifo}
        </span>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              color: colores.texto,
              fontSize: 'var(--mev-texto-xs)',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {p.etiqueta}
          </p>
          <h1
            id="mev-titulo-confianza"
            style={{
              margin: 'var(--mev-esp-1) 0 0',
              fontSize: 'var(--mev-texto-xl)',
              lineHeight: 1.2,
              color: 'var(--mev-tinta)',
            }}
          >
            {p.titulo}
          </h1>
          <p
            style={{
              margin: 'var(--mev-esp-3) 0 0',
              color: 'var(--mev-tinta-suave)',
              fontSize: 'var(--mev-texto-sm)',
              lineHeight: 1.6,
            }}
          >
            {p.explicacion}
          </p>
        </div>
      </div>

      {simulado ? (
        <div style={{ marginTop: 'var(--mev-esp-4)' }}>
          <Aviso tono="alerta" titulo="Entorno de simulacion">
            Esta lectura se produjo con un proveedor NFC simulado. No constituye una
            verificacion real y no debe usarse para decidir sobre una compra.
          </Aviso>
        </div>
      ) : null}

      {children ? <div style={{ marginTop: 'var(--mev-esp-4)' }}>{children}</div> : null}
    </section>
  );
}

// --- Aviso ------------------------------------------------------------------

export interface AvisoProps {
  tono?: 'exito' | 'neutro' | 'alerta' | 'error';
  titulo?: string;
  children: ReactNode;
}

export function Aviso({ tono = 'neutro', titulo, children }: AvisoProps) {
  const colores = TONO_A_VARIABLES[tono]!;
  const esUrgente = tono === 'error' || tono === 'alerta';

  return (
    <div
      role={esUrgente ? 'alert' : 'note'}
      style={{
        background: colores.fondo,
        borderLeft: `4px solid ${colores.texto}`,
        borderRadius: 'var(--mev-radio-sm)',
        padding: 'var(--mev-esp-3) var(--mev-esp-4)',
        fontSize: 'var(--mev-texto-sm)',
        lineHeight: 1.6,
        color: 'var(--mev-tinta)',
      }}
    >
      {titulo ? (
        <strong style={{ display: 'block', color: colores.texto, marginBottom: 'var(--mev-esp-1)' }}>
          {/* El glifo evita depender del color tambien en los avisos. */}
          <span aria-hidden="true">{esUrgente ? '! ' : ''}</span>
          {titulo}
        </strong>
      ) : null}
      {children}
    </div>
  );
}

// --- Insignia ---------------------------------------------------------------

export function Insignia({
  children,
  tono = 'neutro',
}: {
  children: ReactNode;
  tono?: 'exito' | 'neutro' | 'alerta' | 'error';
}) {
  const colores = TONO_A_VARIABLES[tono]!;
  return (
    <span
      style={{
        display: 'inline-block',
        background: colores.fondo,
        color: colores.texto,
        border: `1px solid ${colores.texto}`,
        borderRadius: '999px',
        padding: '0.125rem 0.625rem',
        fontSize: 'var(--mev-texto-xs)',
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

// --- Tarjeta ----------------------------------------------------------------

export function Tarjeta({
  children,
  titulo,
  style,
}: {
  children: ReactNode;
  titulo?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: 'var(--mev-fondo)',
        border: '1px solid var(--mev-linea)',
        borderRadius: 'var(--mev-radio)',
        padding: 'var(--mev-esp-5)',
        boxShadow: 'var(--mev-sombra)',
        ...style,
      }}
    >
      {titulo ? (
        <h2
          style={{
            margin: '0 0 var(--mev-esp-4)',
            fontSize: 'var(--mev-texto-lg)',
            color: 'var(--mev-tinta)',
          }}
        >
          {titulo}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

// --- Boton ------------------------------------------------------------------

export interface BotonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variante?: 'primario' | 'secundario' | 'peligro';
  deshabilitado?: boolean;
  /** Texto que anuncia el lector de pantalla mientras se procesa. */
  cargando?: boolean;
  anchoCompleto?: boolean;
}

export function Boton({
  children,
  onClick,
  type = 'button',
  variante = 'primario',
  deshabilitado,
  cargando,
  anchoCompleto,
}: BotonProps) {
  const estilos: Record<string, CSSProperties> = {
    primario: { background: 'var(--mev-verde-700)', color: '#fff', border: '2px solid transparent' },
    secundario: {
      background: 'transparent',
      color: 'var(--mev-verde-500)',
      border: '2px solid var(--mev-verde-500)',
    },
    peligro: { background: 'var(--mev-error)', color: '#fff', border: '2px solid transparent' },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={deshabilitado || cargando}
      // Comunica el estado ocupado a la tecnologia asistiva, no solo visualmente.
      aria-busy={cargando ? 'true' : undefined}
      style={{
        ...estilos[variante],
        width: anchoCompleto ? '100%' : undefined,
        // 44px de alto minimo: objetivo tactil comodo en movil.
        minHeight: '2.75rem',
        padding: 'var(--mev-esp-3) var(--mev-esp-5)',
        borderRadius: 'var(--mev-radio-sm)',
        fontSize: 'var(--mev-texto-md)',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: deshabilitado || cargando ? 'not-allowed' : 'pointer',
        opacity: deshabilitado || cargando ? 0.6 : 1,
      }}
    >
      {cargando ? 'Procesando…' : children}
    </button>
  );
}

// --- Campo de texto ---------------------------------------------------------

export interface CampoTextoProps {
  id: string;
  etiqueta: string;
  tipo?: 'text' | 'email' | 'password' | 'number';
  valor: string;
  onChange: (valor: string) => void;
  requerido?: boolean;
  ayuda?: string;
  error?: string;
  autoComplete?: string;
  multilinea?: boolean;
}

export function CampoTexto({
  id,
  etiqueta,
  tipo = 'text',
  valor,
  onChange,
  requerido,
  ayuda,
  error,
  autoComplete,
  multilinea,
}: CampoTextoProps) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  // `aria-describedby` enlaza ayuda y error con el campo, para que el lector de
  // pantalla los anuncie al enfocarlo.
  const describedBy = [idAyuda, idError].filter(Boolean).join(' ') || undefined;

  const estiloCampo: CSSProperties = {
    width: '100%',
    minHeight: '2.75rem',
    padding: 'var(--mev-esp-3)',
    borderRadius: 'var(--mev-radio-sm)',
    border: `2px solid ${error ? 'var(--mev-error)' : 'var(--mev-linea)'}`,
    background: 'var(--mev-fondo)',
    color: 'var(--mev-tinta)',
    fontSize: 'var(--mev-texto-md)',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ marginBottom: 'var(--mev-esp-4)' }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 'var(--mev-esp-2)',
          fontSize: 'var(--mev-texto-sm)',
          fontWeight: 600,
          color: 'var(--mev-tinta)',
        }}
      >
        {etiqueta}
        {requerido ? (
          <>
            {' '}
            <span aria-hidden="true" style={{ color: 'var(--mev-error)' }}>
              *
            </span>
            <span className="mev-solo-lectores"> (obligatorio)</span>
          </>
        ) : null}
      </label>

      {multilinea ? (
        <textarea
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          required={requerido}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          rows={5}
          style={estiloCampo}
        />
      ) : (
        <input
          id={id}
          type={tipo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          required={requerido}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          style={estiloCampo}
        />
      )}

      {ayuda ? (
        <p
          id={idAyuda}
          style={{
            margin: 'var(--mev-esp-2) 0 0',
            fontSize: 'var(--mev-texto-xs)',
            color: 'var(--mev-tinta-suave)',
          }}
        >
          {ayuda}
        </p>
      ) : null}

      {error ? (
        <p
          id={idError}
          role="alert"
          style={{
            margin: 'var(--mev-esp-2) 0 0',
            fontSize: 'var(--mev-texto-xs)',
            color: 'var(--mev-error)',
            fontWeight: 600,
          }}
        >
          <span aria-hidden="true">! </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- Conmutador -------------------------------------------------------------

export function Conmutador({
  id,
  etiqueta,
  descripcion,
  activo,
  onChange,
  deshabilitado,
}: {
  id: string;
  etiqueta: string;
  descripcion?: string;
  activo: boolean;
  onChange: (activo: boolean) => void;
  deshabilitado?: boolean;
}) {
  const idDescripcion = descripcion ? `${id}-desc` : undefined;

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--mev-esp-4)',
        alignItems: 'flex-start',
        padding: 'var(--mev-esp-4) 0',
        borderBottom: '1px solid var(--mev-linea)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <label htmlFor={id} style={{ fontWeight: 600, color: 'var(--mev-tinta)', cursor: 'pointer' }}>
          {etiqueta}
        </label>
        {descripcion ? (
          <p
            id={idDescripcion}
            style={{
              margin: 'var(--mev-esp-1) 0 0',
              fontSize: 'var(--mev-texto-sm)',
              color: 'var(--mev-tinta-suave)',
              lineHeight: 1.5,
            }}
          >
            {descripcion}
          </p>
        ) : null}
      </div>
      {/* Casilla nativa: hereda todo el comportamiento de teclado y de lector
          de pantalla sin reimplementarlo. El estado tambien se expresa en texto. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mev-esp-2)' }}>
        <span
          aria-hidden="true"
          style={{
            fontSize: 'var(--mev-texto-xs)',
            fontWeight: 600,
            color: activo ? 'var(--mev-exito)' : 'var(--mev-tinta-suave)',
          }}
        >
          {activo ? 'Si' : 'No'}
        </span>
        <input
          id={id}
          type="checkbox"
          checked={activo}
          disabled={deshabilitado}
          aria-describedby={idDescripcion}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: '1.5rem', height: '1.5rem', cursor: 'pointer', accentColor: 'var(--mev-verde-700)' }}
        />
      </div>
    </div>
  );
}

// --- Lista de definiciones --------------------------------------------------

export interface Definicion {
  termino: string;
  valor: ReactNode;
}

export function ListaDefiniciones({ datos }: { datos: Definicion[] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gap: 'var(--mev-esp-3)' }}>
      {datos.map((d) => (
        <div
          key={d.termino}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(7rem, 40%) 1fr',
            gap: 'var(--mev-esp-3)',
            paddingBottom: 'var(--mev-esp-3)',
            borderBottom: '1px solid var(--mev-linea)',
          }}
        >
          <dt style={{ fontSize: 'var(--mev-texto-sm)', color: 'var(--mev-tinta-suave)' }}>
            {d.termino}
          </dt>
          <dd
            style={{
              margin: 0,
              fontSize: 'var(--mev-texto-sm)',
              fontWeight: 600,
              color: 'var(--mev-tinta)',
              wordBreak: 'break-word',
            }}
          >
            {d.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// --- Cargando ---------------------------------------------------------------

export function Cargando({ mensaje = 'Cargando…' }: { mensaje?: string }) {
  return (
    <div
      role="status"
      // `polite` para no interrumpir lo que el usuario esta leyendo.
      aria-live="polite"
      style={{
        padding: 'var(--mev-esp-6)',
        textAlign: 'center',
        color: 'var(--mev-tinta-suave)',
        fontSize: 'var(--mev-texto-sm)',
      }}
    >
      {mensaje}
    </div>
  );
}

// --- Estado vacio -----------------------------------------------------------

export function EstadoVacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div
      style={{
        padding: 'var(--mev-esp-6)',
        textAlign: 'center',
        border: '1px dashed var(--mev-linea)',
        borderRadius: 'var(--mev-radio)',
        color: 'var(--mev-tinta-suave)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--mev-tinta)' }}>{titulo}</p>
      {children ? (
        <p style={{ margin: 'var(--mev-esp-2) 0 0', fontSize: 'var(--mev-texto-sm)' }}>{children}</p>
      ) : null}
    </div>
  );
}
