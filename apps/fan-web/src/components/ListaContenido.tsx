import { Aviso, Insignia, Tarjeta } from '@mev/ui';
import type { RespuestaContenido } from '@/lib/api';

/** Etiquetas legibles de los tipos de contenido. */
const TIPOS: Record<string, string> = {
  HERO: 'Destacado',
  STORY: 'Historia',
  VIDEO: 'Video',
  QUIZ: 'Trivia',
  POLL: 'Encuesta',
  REWARD_TEASER: 'Recompensa',
  SPONSOR_MESSAGE: 'Patrocinado',
  MATCH_CARD: 'Partido',
  CARE_INSTRUCTIONS: 'Cuidado de la prenda',
};

export function ListaContenido({ contenido }: { contenido: RespuestaContenido }) {
  const algoOmitido = contenido.items.some((i) => i.mediaOmittedForLowData);

  return (
    <section aria-labelledby="titulo-contenido" className="mev-pila">
      <h2 id="titulo-contenido" className="mev-titulo-pagina" style={{ fontSize: 'var(--mev-texto-lg)' }}>
        Para usted
      </h2>

      {contenido.lowDataMode ? (
        <Aviso tono="neutro" titulo="Modo de bajo consumo de datos activo">
          {algoOmitido
            ? 'Omitimos los videos e imagenes pesadas para ahorrar sus datos.'
            : 'Estamos cargando solo el contenido ligero.'}
        </Aviso>
      ) : null}

      <ul className="mev-lista-limpia">
        {contenido.items.map((item) => (
          <li key={item.id}>
            <Tarjeta>
              <div style={{ marginBottom: 'var(--mev-esp-2)' }}>
                <Insignia tono={item.kind === 'SPONSOR_MESSAGE' ? 'alerta' : 'neutro'}>
                  {TIPOS[item.kind] ?? item.kind}
                </Insignia>
              </div>

              <h3 className="mev-titulo-tarjeta">{item.title}</h3>
              <p className="mev-contenido-cuerpo">{item.body}</p>

              {item.mediaOmittedForLowData ? (
                <p style={{ fontSize: 'var(--mev-texto-xs)', color: 'var(--mev-tinta-suave)' }}>
                  Contenido multimedia omitido para ahorrar datos.{' '}
                  <a href="?lowData=0">Cargar de todas formas</a>
                </p>
              ) : null}

              {item.mediaUrl && item.kind === 'VIDEO' ? (
                <video
                  controls
                  preload="none"
                  style={{ width: '100%', borderRadius: 'var(--mev-radio-sm)' }}
                >
                  <source src={item.mediaUrl} />
                  {/* Los subtitulos se declaran siempre que existan: sin ellos el
                      video es inaccesible para personas sordas. */}
                  {item.captionsUrl ? (
                    <track
                      kind="captions"
                      src={item.captionsUrl}
                      srcLang="es"
                      label="Espanol"
                      default
                    />
                  ) : null}
                  Su navegador no puede reproducir este video.
                </video>
              ) : null}

              {item.mediaUrl && item.kind !== 'VIDEO' ? (
                // `alt` obligatorio. Si la API no envio texto alternativo, la
                // imagen se marca como decorativa en lugar de dejar un alt vacio
                // ambiguo.
                <img
                  src={item.mediaUrl}
                  alt={item.mediaAlt ?? ''}
                  aria-hidden={item.mediaAlt ? undefined : 'true'}
                  style={{ borderRadius: 'var(--mev-radio-sm)', marginTop: 'var(--mev-esp-3)' }}
                />
              ) : null}

              {item.ctaHref && item.ctaLabel ? (
                <p style={{ marginTop: 'var(--mev-esp-3)', marginBottom: 0 }}>
                  <a href={item.ctaHref}>{item.ctaLabel}</a>
                </p>
              ) : null}
            </Tarjeta>
          </li>
        ))}
      </ul>
    </section>
  );
}
