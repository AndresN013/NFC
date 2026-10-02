import { VistaVerificacion } from '@/components/VistaVerificacion';

/**
 * Codigo QR de respaldo, para telefonos sin NFC.
 *
 * El token del QR pertenece a un ESPACIO DE IDENTIFICADORES DISTINTO del token
 * del chip: fotografiar el QR no revela el secreto del NFC. Y su techo de
 * confianza es menor por definicion, porque un codigo impreso es trivialmente
 * copiable.
 */

export const dynamic = 'force-dynamic';

export default async function PaginaVerificacionQr({
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
      metodo="QR_CODE"
      bajoConsumo={lowData === '1'}
    />
  );
}
