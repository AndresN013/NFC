import Link from 'next/link';
import { Aviso, Tarjeta } from '@mev/ui';

export default function PaginaInicio() {
  return (
    <div className="mev-pila">
      <div>
        <h1 className="mev-titulo-pagina">El escudo de su jersey cuenta su historia</h1>
        <p className="mev-subtitulo">
          Acerque su telefono al escudo bordado. Se abrira esta web con la informacion de su prenda.
          No necesita instalar ninguna aplicacion.
        </p>
      </div>

      <Tarjeta titulo="Como consultar su jersey">
        <ol style={{ paddingLeft: '1.25rem', margin: 0, display: 'grid', gap: 'var(--mev-esp-3)' }}>
          <li>
            <strong>Con NFC.</strong> Apoye la parte superior de su telefono sobre el centro del
            escudo y mantengalo quieto un segundo.
          </li>
          <li>
            <strong>Sin NFC.</strong> Si su telefono no tiene NFC o esta desactivado, escanee el
            codigo de respaldo impreso en la etiqueta interior.
          </li>
        </ol>
      </Tarjeta>

      <Tarjeta titulo="Que le vamos a mostrar, y que no">
        <p style={{ marginTop: 0 }}>
          Le diremos con claridad <strong>que nivel de comprobacion</strong> alcanzo la lectura. No
          todas las lecturas valen lo mismo:
        </p>
        <ul style={{ paddingLeft: '1.25rem', display: 'grid', gap: 'var(--mev-esp-2)' }}>
          <li>
            <strong>Identificado:</strong> reconocemos la prenda en nuestro registro.
          </li>
          <li>
            <strong>Verificado:</strong> ademas, el chip respondio a una comprobacion de seguridad.
          </li>
        </ul>
        <Aviso tono="neutro" titulo="Por que lo distinguimos">
          Un identificador puede copiarse. Una comprobacion criptografica, no. Preferimos decirle
          exactamente que comprobamos antes que darle una garantia que no podemos sostener.
        </Aviso>
      </Tarjeta>

      <Tarjeta titulo="Su privacidad">
        <p style={{ marginTop: 0 }}>
          Consultar su jersey <strong>no exige crear una cuenta</strong> ni aceptar publicidad.
          Tampoco guardamos su ubicacion exacta.
        </p>
        <p style={{ marginBottom: 0 }}>
          <Link href="/preferencias">Consultar y gestionar sus preferencias</Link>
        </p>
      </Tarjeta>

      <Tarjeta titulo="Necesita ayuda">
        <p style={{ margin: 0 }}>
          Si el escudo no responde, si duda del origen de su prenda o si quiere usar la garantia,{' '}
          <Link href="/soporte">abra un caso de soporte</Link>. No hace falta tener cuenta.
        </p>
      </Tarjeta>
    </div>
  );
}
