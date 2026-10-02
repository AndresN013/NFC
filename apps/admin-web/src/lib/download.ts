/** Descarga de ficheros generados en el cliente. Solo se usa en el navegador. */

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  if (typeof document === 'undefined') return;
  // El BOM hace que Excel en Windows abra el CSV como UTF-8 y no rompa acentos.
  const blob = new Blob([`${text}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
