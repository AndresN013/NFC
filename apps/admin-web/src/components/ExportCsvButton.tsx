'use client';

import { useState } from 'react';
import { ApiError, type Query } from '@/lib/api-client';
import { downloadTextFile } from '@/lib/download';
import { useSession } from './SessionProvider';
import { Button, Callout } from './ui';

/**
 * Exportacion CSV de un listado que la API sabe exportar.
 *
 * Reexporta los filtros activos, no la pagina visible: quien exporta espera el
 * conjunto filtrado completo. Si la API responde `x-export-truncated: true`, se
 * avisa en pantalla: un fichero incompleto que no se anuncia se interpreta como
 * el total y acaba en un informe equivocado.
 */
export function ExportCsvButton({
  path,
  query,
  fallbackName,
  label = 'Exportar CSV',
}: {
  path: string;
  query?: Query;
  fallbackName: string;
  label?: string;
}): React.ReactElement {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setTruncated(false);
    try {
      const result = await api.getCsv(path, { ...query, format: 'csv' });
      downloadTextFile(result.filename || fallbackName, result.text);
      setTruncated(result.truncated);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'No se pudo generar la exportacion.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={handleExport} disabled={busy} aria-busy={busy || undefined}>
        {busy ? 'Generando…' : label}
      </Button>

      {/* Region viva: el resultado de la exportacion se anuncia sin mover el foco. */}
      <div aria-live="polite">
        {truncated ? (
          <Callout variant="aviso" title="La exportación está truncada">
            <p>
              La API alcanzó su límite de filas por exportación, así que el fichero descargado
              <strong> no contiene todos los resultados</strong>. Acote los filtros (por estado,
              club u orden) y vuelva a exportar por partes.
            </p>
          </Callout>
        ) : null}
        {error ? (
          <Callout variant="peligro" title="No se pudo exportar">
            <p>{error}</p>
          </Callout>
        ) : null}
      </div>
    </>
  );
}
