'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';
import type { StateDescriptor, Tone } from '@/lib/format';
import { rangeLabel, totalPages } from '@/lib/format';
import styles from './ui.module.css';

const TONE_CLASS: Record<Tone, string> = {
  neutro: styles.tonoNeutro!,
  positivo: styles.tonoPositivo!,
  aviso: styles.tonoAviso!,
  peligro: styles.tonoPeligro!,
};

/**
 * Etiqueta de estado.
 *
 * Muestra SIEMPRE simbolo + texto. El color solo refuerza: una persona que no
 * distingue rojo de verde, o que imprime la tabla en blanco y negro, sigue
 * leyendo el estado. El simbolo se marca `aria-hidden` porque el texto que va
 * al lado ya dice lo mismo.
 */
export function StateTag({ descriptor }: { descriptor: StateDescriptor }): React.ReactElement {
  return (
    <span className={`${styles.etiqueta} ${TONE_CLASS[descriptor.tone]}`}>
      <span className={styles.simbolo} aria-hidden="true">
        {descriptor.symbol}
      </span>
      {descriptor.label}
    </span>
  );
}

export type CalloutVariant = 'info' | 'aviso' | 'peligro';

const CALLOUT_CLASS: Record<CalloutVariant, string> = {
  info: styles.avisoInfo!,
  aviso: styles.avisoAviso!,
  peligro: styles.avisoPeligro!,
};

/** Aviso destacado. Los de tono fuerte se anuncian como region de nota. */
export function Callout({
  variant = 'info',
  title,
  children,
}: {
  variant?: CalloutVariant;
  title?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className={`${styles.aviso} ${CALLOUT_CLASS[variant]}`} role="note">
      {title ? <strong className={styles.avisoTitulo}>{title}</strong> : null}
      {children}
    </div>
  );
}

export function Button({
  variant = 'normal',
  type = 'button',
  ...rest
}: {
  variant?: 'normal' | 'primario' | 'peligro' | 'discreto';
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  const variantClass =
    variant === 'primario'
      ? styles.botonPrimario
      : variant === 'peligro'
        ? styles.botonPeligro
        : variant === 'discreto'
          ? styles.botonDiscreto
          : '';
  return <button type={type} className={`${styles.boton} ${variantClass}`} {...rest} />;
}

/** Campo de formulario con etiqueta asociada, ayuda y error accesibles. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby': string | undefined }) => ReactNode;
}): React.ReactElement {
  const id = useId();
  const hintId = hint ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.campo}>
      <label className={styles.campoEtiqueta} htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy })}
      {hint ? (
        <span className={styles.campoAyuda} id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={styles.campoError} id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Selector simple de filtro, con opcion "todos" incluida. */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel = 'Todos',
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: readonly { value: string; label: string }[];
  allLabel?: string;
}): React.ReactElement {
  return (
    <Field label={label}>
      {(props) => (
        <select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * Buscador. Envia con el formulario para que Enter funcione y para que un
 * lector de pantalla anuncie la region como busqueda.
 */
export function SearchFilter({
  label,
  value,
  onSubmit,
  placeholder,
}: {
  label: string;
  value: string;
  onSubmit(value: string): void;
  placeholder?: string;
}): React.ReactElement {
  return (
    <form
      role="search"
      className={styles.acciones}
      onSubmit={(event) => {
        event.preventDefault();
        const input = new FormData(event.currentTarget).get('busqueda');
        onSubmit(typeof input === 'string' ? input.trim() : '');
      }}
    >
      <Field label={label}>
        {(props) => (
          <input
            {...props}
            type="search"
            name="busqueda"
            defaultValue={value}
            placeholder={placeholder}
          />
        )}
      </Field>
      <Button type="submit">Buscar</Button>
    </form>
  );
}

export function FilterBar({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <section className={styles.filtros} aria-label="Filtros y acciones">
      {children}
    </section>
  );
}

export function Actions({ children }: { children: ReactNode }): React.ReactElement {
  return <div className={styles.acciones}>{children}</div>;
}

/** Paginacion accesible: botones con nombre claro y estado anunciado. */
export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange(page: number): void;
}): React.ReactElement {
  const pages = totalPages(total, pageSize);
  return (
    <nav className={styles.paginacion} aria-label="Paginacion de resultados">
      <p className={styles.paginacionTexto} role="status">
        {rangeLabel(total, page, pageSize)}
      </p>
      <div className={styles.acciones}>
        <Button onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Anterior
        </Button>
        <span className={styles.paginacionTexto}>
          Pagina {page} de {pages}
        </span>
        <Button onClick={() => onPageChange(page + 1)} disabled={page >= pages}>
          Siguiente
        </Button>
      </div>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <header className={styles.cabecera}>
      <div className={styles.cabeceraTexto}>
        <h1>{title}</h1>
        {description ? <p className={styles.cabeceraDescripcion}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.acciones}>{actions}</div> : null}
    </header>
  );
}

/** Rejilla de metricas. Es una lista para que se anuncie el numero de tarjetas. */
export function MetricGrid({
  items,
  label,
}: {
  label: string;
  items: readonly { label: string; value: string; detail?: string }[];
}): React.ReactElement {
  return (
    <ul className={styles.rejilla} aria-label={label}>
      {items.map((item) => (
        <li className={styles.tarjeta} key={item.label}>
          <span className={styles.tarjetaValor}>{item.value}</span>
          <span className={styles.tarjetaEtiqueta}>{item.label}</span>
          {item.detail ? (
            <>
              <br />
              <span className={styles.tarjetaEtiqueta}>{item.detail}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tarjeta con titulo.
 *
 * `onSubmit` y `footer` son opcionales: no toda tarjeta es un formulario. Sin un
 * `onSubmit`, se renderiza como `<section>` en lugar de `<form>`, porque un
 * formulario sin accion de envio es ruido para un lector de pantalla.
 */
export function FormCard({
  title,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer?: ReactNode;
}): React.ReactElement {
  const contenido = (
    <>
      <h2>{title}</h2>
      {children}
      {footer ? <div className={styles.acciones}>{footer}</div> : null}
    </>
  );

  if (!onSubmit) {
    return <section className={styles.formulario}>{contenido}</section>;
  }

  return (
    <form className={styles.formulario} onSubmit={onSubmit}>
      {contenido}
    </form>
  );
}

export function FormRow({ children }: { children: ReactNode }): React.ReactElement {
  return <div className={styles.formularioFila}>{children}</div>;
}

export function DefinitionList({
  items,
}: {
  items: readonly { term: string; value: ReactNode }[];
}): React.ReactElement {
  return (
    <dl className={styles.definiciones}>
      {items.map((item) => (
        <div key={item.term} style={{ display: 'contents' }}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const uiStyles = styles;
