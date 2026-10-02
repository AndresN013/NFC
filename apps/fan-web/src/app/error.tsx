'use client';

import { Aviso, Boton, Tarjeta } from '@mev/ui';

/**
 * Frontera de error de la aplicacion.
 *
 * NUNCA se muestra `error.message` al usuario: puede contener detalle interno.
 * Solo se expone el `digest`, que es el identificador con el que soporte puede
 * localizar la traza en el servidor.
 */
export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mev-pila">
      <h1 className="mev-titulo-pagina">Algo salio mal</h1>

      <Aviso tono="error" titulo="No pudimos completar la operacion">
        Intente de nuevo. Si el problema persiste, abra un caso de soporte.
        {error.digest ? (
          <>
            {' '}
            Referencia tecnica: <code>{error.digest}</code>
          </>
        ) : null}
      </Aviso>

      <Tarjeta>
        <Boton onClick={reset}>Intentar de nuevo</Boton>
      </Tarjeta>
    </div>
  );
}
