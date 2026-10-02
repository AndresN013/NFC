import Link from 'next/link';
import { Aviso, Tarjeta } from '@mev/ui';

export default function NoEncontrado() {
  return (
    <div className="mev-pila">
      <h1 className="mev-titulo-pagina">No encontramos esta pagina</h1>
      <Aviso tono="neutro" titulo="Puede que el enlace este incompleto">
        Si llego aqui tras acercar el telefono al escudo, intentelo de nuevo apoyando el telefono
        sobre el centro del escudo y sin moverlo.
      </Aviso>
      <Tarjeta>
        <div className="mev-fila-acciones">
          <Link href="/">Ir al inicio</Link>
          <Link href="/soporte">Abrir un caso de soporte</Link>
        </div>
      </Tarjeta>
    </div>
  );
}
