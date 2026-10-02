import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Insignia, ListaDefiniciones, Tarjeta, formatearFecha, nombreCondicion, nombreEdicion } from '@mev/ui';
import { obtenerCertificado } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function PaginaCertificado({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const certificado = await obtenerCertificado(handle).catch(() => null);
  if (!certificado) notFound();

  const revocado = certificado.revokedAt != null;

  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">Certificado digital</h1>
        <p className="mev-subtitulo">
          Documento del registro de esta prenda en la plataforma de Marathon.
        </p>
      </div>

      {revocado ? (
        <Aviso tono="error" titulo="Certificado revocado">
          Este certificado fue dado de baja el {formatearFecha(certificado.revokedAt)}. Contacte a
          soporte si necesita mas informacion.
        </Aviso>
      ) : null}

      <Tarjeta>
        <div style={{ marginBottom: 'var(--mev-esp-4)', display: 'flex', gap: 'var(--mev-esp-2)', flexWrap: 'wrap' }}>
          <Insignia tono={revocado ? 'error' : 'neutro'}>
            {revocado ? 'Revocado' : 'Vigente'}
          </Insignia>
          <Insignia tono="neutro">{nombreEdicion(certificado.edition)}</Insignia>
        </div>

        <ListaDefiniciones
          datos={[
            { termino: 'Numero de serie', valor: certificado.serial ?? 'No disponible' },
            { termino: 'Club', valor: certificado.club },
            { termino: 'Temporada', valor: certificado.season },
            { termino: 'Modelo', valor: certificado.model },
            { termino: 'Edicion', valor: nombreEdicion(certificado.edition) },
            ...(certificado.size ? [{ termino: 'Talla', valor: certificado.size }] : []),
            ...(certificado.playerName
              ? [{ termino: 'Jugador', valor: certificado.playerName }]
              : []),
            ...(certificado.shirtNumber != null
              ? [{ termino: 'Dorsal', valor: String(certificado.shirtNumber) }]
              : []),
            { termino: 'Identificador', valor: certificado.maskedRef },
            {
              termino: 'Fecha de activacion',
              valor: formatearFecha(certificado.activatedAt) ?? 'No disponible',
            },
            { termino: 'Estado de la prenda', valor: nombreCondicion(certificado.condition) },
            {
              termino: 'Emitido',
              valor: formatearFecha(certificado.issuedAt) ?? 'No disponible',
            },
          ]}
        />
      </Tarjeta>

      {/* Advertencia obligatoria: el certificado acredita el registro, no la
          autenticidad criptografica. Se muestra siempre, no en letra pequena. */}
      <Aviso tono="neutro" titulo="Alcance de este certificado">
        {certificado.disclaimer}
      </Aviso>

      <p>
        <Link href="/soporte">Tiene dudas sobre este certificado</Link>
      </p>
    </div>
  );
}
