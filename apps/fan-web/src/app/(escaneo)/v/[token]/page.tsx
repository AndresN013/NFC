import { VistaVerificacion } from '@/components/VistaVerificacion';

/**
 * Pagina que abre el chip NFC del escudo.
 *
 * El registro NDEF del chip apunta aqui: `https://.../v/<token>`.
 *
 * `NFC_STATIC_URL` es el metodo declarado porque eso es exactamente lo que
 * ocurrio: un telefono leyo una URL estatica. El techo de confianza de ese
 * metodo es IDENTIFIED_ONLY, y lo impone el servidor de la API.
 *
 * Cuando exista la integracion con NTAG 424 DNA, el chip anadira un mensaje
 * autenticado a la URL y esta pagina debera reenviarlo para que el servidor lo
 * valide. Ver docs/guia-ntag424-dna.md
 */

// Sin cache: cada lectura es un evento distinto y debe registrarse.
export const dynamic = 'force-dynamic';

export default async function PaginaVerificacionNfc({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lowData?: string }>;
}) {
  const { token } = await params;
  const { lowData } = await searchParams;

  return (
    <VistaVerificacion
      token={decodeURIComponent(token)}
      metodo="NFC_STATIC_URL"
      bajoConsumo={lowData === '1'}
    />
  );
}
