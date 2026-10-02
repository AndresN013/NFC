'use client';

import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api-client';
import styles from './DataTable.module.css';

export interface Column<T> {
  /** Identificador estable de la columna. */
  key: string;
  header: string;
  render(row: T): ReactNode;
  /** Alinea a la derecha y usa cifras tabulares. */
  numeric?: boolean;
  /**
   * Marca la celda como cabecera de su fila (`<th scope="row">`).
   * Debe usarse en la columna que identifica la fila: es lo que un lector de
   * pantalla anuncia al recorrer las demas celdas.
   */
  rowHeader?: boolean;
}

export interface DataTableProps<T> {
  /** Obligatoria: describe la tabla para quien no ve la pagina. */
  caption: string;
  /** Detalle opcional bajo la leyenda (filtros aplicados, avisos, total). */
  captionDetail?: ReactNode;
  columns: readonly Column<T>[];
  rows: readonly T[] | null;
  getRowKey(row: T, index: number): string;
  loading?: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  emptyMessage?: string;
}

/**
 * Tabla accesible reutilizable.
 *
 * Es una `<table>` de verdad, no una rejilla de divs: eso da gratis la
 * navegacion por celdas de los lectores de pantalla, el anuncio de la cabecera
 * de cada columna y la relacion fila/columna. Tambien concentra los tres
 * estados de todo listado (cargando, vacio, error) para que ninguna pagina se
 * olvide de alguno.
 */
export function DataTable<T>({
  caption,
  captionDetail,
  columns,
  rows,
  getRowKey,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No hay datos para mostrar.',
}: DataTableProps<T>): React.ReactElement {
  const hasRows = rows !== null && rows.length > 0;

  return (
    <div className={styles.contenedor} aria-busy={loading || undefined}>
      <table className={styles.tabla}>
        <caption className={styles.leyenda}>
          {caption}
          {captionDetail ? <span className={styles.leyendaDetalle}>{captionDetail}</span> : null}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? styles.numerica : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !hasRows ? (
            <tr>
              <td className={styles.estado} colSpan={columns.length}>
                {/* role=status para que el cambio se anuncie sin robar el foco. */}
                <span role="status">Cargando datos…</span>
              </td>
            </tr>
          ) : null}

          {!loading && error ? (
            <tr>
              <td className={`${styles.estado} ${styles.estadoError}`} colSpan={columns.length}>
                <span role="alert">No se pudieron cargar los datos: {error.message}</span>
                {onRetry ? (
                  <>
                    {' '}
                    <button type="button" onClick={onRetry}>
                      Reintentar
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ) : null}

          {!loading && !error && !hasRows ? (
            <tr>
              <td className={styles.estado} colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}

          {hasRows
            ? rows.map((row, index) => (
                <tr key={getRowKey(row, index)}>
                  {columns.map((column) =>
                    column.rowHeader ? (
                      <th key={column.key} scope="row">
                        {column.render(row)}
                      </th>
                    ) : (
                      <td key={column.key} className={column.numeric ? styles.numerica : undefined}>
                        {column.render(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </div>
  );
}

/** Celda para identificadores tecnicos (UID, referencias, codigos). */
export function Mono({ children }: { children: ReactNode }): React.ReactElement {
  return <span className={styles.monoespaciada}>{children}</span>;
}
