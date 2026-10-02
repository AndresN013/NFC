import Link from 'next/link';
import { headers } from 'next/headers';
import {
  obtenerContenido,
  verificarToken,
  ApiError,
  type MetodoVerificacion,
  type ResultadoVerificacion,
} from '@/lib/api';
import {
  RESULTADOS,
  fechaLarga,
  hexARgb,
  textoModelo,
  textoSobre,
  textoTemporada,
} from './resultado';
import { BarraMarathon, PieMarathon, SelloMarathon } from './Marca';
import estilos from './verificacion.module.css';

/**
 * La pantalla que ve el aficionado al acercar el telefono al escudo.
 *
 * Objetivo unico: que en el primer segundo sepa que su camiseta esta bien, y que
 * se sienta bien al verlo. Todo lo demas es secundario y va mas abajo.
 *
 * Se ejecuta en el servidor, asi que el identificador del chip nunca llega al
 * JavaScript del navegador.
 */

interface Props {
  token: string;
  metodo: MetodoVerificacion;
  bajoConsumo: boolean;
}

async function cabecerasReenviadas(): Promise<Record<string, string>> {
  const entrantes = await headers();
  const reenviadas: Record<string, string> = {};
  for (const nombre of ['accept-language', 'save-data', 'x-forwarded-for', 'cf-ipcountry']) {
    const valor = entrantes.get(nombre);
    if (valor) reenviadas[nombre] = valor;
  }
  return reenviadas;
}

export async function VistaVerificacion({ token, metodo, bajoConsumo }: Props) {
  const forward = await cabecerasReenviadas();

  let resultado: ResultadoVerificacion;
  try {
    resultado = await verificarToken(token, metodo, forward);
  } catch (error) {
    const demasiadas = error instanceof ApiError && error.status === 429;
    return (
      <div className={estilos.pantalla}>
        <BarraMarathon compacta />
        <div className={estilos.heroe} style={{ background: '#35506b' }}>
          <span className={estilos.simbolo} aria-hidden="true">
            ↻
          </span>
          <h1 className={estilos.titulo}>Casi lo tenemos</h1>
          <p className={estilos.subtitulo}>
            {demasiadas
              ? 'Estamos recibiendo muchas consultas. Espera un momento e intenta otra vez.'
              : 'No pudimos conectarnos. Acerca el telefono al escudo otra vez.'}
          </p>
        </div>
        <div className={estilos.cuerpo}>
          <Link href="/soporte" className={estilos.botonSecundario}>
            Escribir a Marathon
          </Link>
        </div>
      </div>
    );
  }

  const r = RESULTADOS[resultado.trustLevel];
  const unidad = resultado.unit;

  // Cuando la camiseta se reconoce, la pantalla se viste con los colores del
  // club. Es lo que la convierte en "su" camiseta y no en una pantalla generica.
  const fondo = unidad && r.celebra ? unidad.clubColors.primary : r.acento;
  const tinta = textoSobre(fondo);
  const realce = unidad && r.celebra ? unidad.clubColors.secondary : '#ffffff';

  const contenido =
    unidad && r.celebra
      ? await obtenerContenido(unidad.unitHandle, {
          trustLevel: resultado.trustLevel,
          lowData: bajoConsumo,
          forward,
        }).catch(() => null)
      : null;

  // Una sola pieza de contenido: la mas prioritaria. Una lista larga diluye el
  // mensaje principal, que es que la camiseta esta bien.
  const destacado = contenido?.items.find((i) => i.kind !== 'SPONSOR_MESSAGE') ?? null;

  return (
    // El color del club se publica como variable CSS para que el resto de la
    // pantalla pueda tenirse con el. Sin esto, en modo oscuro el cuerpo quedaba
    // negro puro y parecia que la pagina estaba rota.
    <div
      className={estilos.pantalla}
      style={{ ['--club-rgb' as string]: hexARgb(fondo) }}
    >
      {/* La marca aparece ANTES del veredicto: en cuanto se abre el escudo, el
          aficionado ve de quien es la garantia. */}
      <BarraMarathon compacta />

      <div className={estilos.heroe} style={{ background: fondo, color: tinta }}>
        <span
          className={estilos.simbolo}
          style={{ borderColor: realce, color: realce }}
          aria-hidden="true"
        >
          {r.simbolo}
        </span>

        <h1 className={estilos.titulo}>{r.titulo}</h1>
        <p className={estilos.subtitulo}>{r.subtitulo}</p>

        {unidad && r.celebra ? (
          <div className={estilos.identidad}>
            {unidad.shirtNumber != null ? (
              <span className={estilos.dorsal} style={{ color: realce }}>
                {unidad.shirtNumber}
              </span>
            ) : null}
            <span className={estilos.club}>{unidad.club}</span>
            {unidad.playerName ? (
              <span className={estilos.jugador}>{unidad.playerName}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={estilos.cuerpo}>
        {unidad ? (
          <section className={estilos.ficha} aria-label="Datos de tu camiseta">
            <Dato etiqueta="Modelo" valor={textoModelo(unidad.model, unidad.edition)} />
            <Dato etiqueta="Temporada" valor={textoTemporada(unidad.season)} />
            {fechaLarga(unidad.activatedAt) ? (
              <Dato etiqueta="Registrada" valor={fechaLarga(unidad.activatedAt)!} />
            ) : null}
            {resultado.maskedRef ? (
              <Dato etiqueta="Codigo" valor={resultado.maskedRef} />
            ) : null}
          </section>
        ) : null}

        {/* El respaldo de Marathon se afirma solo cuando la lectura es buena.
            En una camiseta revocada seria una contradiccion. */}
        {r.celebra ? <SelloMarathon /> : null}

        {destacado ? (
          <section className={estilos.historia}>
            <h2 className={estilos.historiaTitulo}>{destacado.title}</h2>
            <p className={estilos.historiaTexto}>{destacado.body}</p>
          </section>
        ) : null}

        <div className={estilos.acciones}>
          {r.celebra && unidad ? (
            <>
              <Link href={`/certificado/${unidad.unitHandle}`} className={estilos.botonPrincipal}>
                Ver certificado
              </Link>
              {unidad.claimable ? (
                <Link
                  href={`/reclamar/${unidad.unitHandle}?evento=${resultado.eventRef}`}
                  className={estilos.botonSecundario}
                >
                  Registrarla a mi nombre
                </Link>
              ) : null}
            </>
          ) : (
            <Link href="/soporte" className={estilos.botonPrincipal}>
              {r.accion ?? 'Escribir a Marathon'}
            </Link>
          )}
        </div>

        {metodo === 'QR_CODE' && r.celebra ? (
          <p className={estilos.pie}>
            Leiste el codigo impreso. Si tu telefono tiene NFC, acercalo al escudo para una
            comprobacion mas completa.
          </p>
        ) : null}

        {!r.celebra ? (
          <p className={estilos.pie}>
            Guarda esta referencia por si escribes: <code>{resultado.eventRef.slice(0, 8)}</code>
          </p>
        ) : null}

        {/* Solo aparece en entornos de prueba. En produccion el servidor no
            arranca con el proveedor simulado, asi que nunca se ve. */}
        {resultado.simulated ? (
          <p className={estilos.simulacion}>Entorno de prueba · lectura simulada</p>
        ) : null}
      </div>

      <PieMarathon />
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className={estilos.dato}>
      <dt className={estilos.datoEtiqueta}>{etiqueta}</dt>
      <dd className={estilos.datoValor}>{valor}</dd>
    </div>
  );
}
