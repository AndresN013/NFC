'use client';

/**
 * Sesion del aficionado en el navegador.
 *
 * DECISION: el token se guarda en `sessionStorage`, no en `localStorage` ni en
 * una cookie accesible por script.
 *  - `sessionStorage` se borra al cerrar la pestana, lo cual limita la ventana de
 *    abuso en un telefono compartido o prestado.
 *  - No se usa cookie porque la API es de otro origen y las peticiones van con
 *    cabecera `Authorization`, lo que elimina de raiz la superficie de CSRF.
 *
 * Limitacion conocida: `sessionStorage` es accesible desde JavaScript, asi que
 * un XSS podria leerlo. La mitigacion es la Content Security Policy y la
 * ausencia de HTML sin sanear. Ver docs/modelo-amenazas.md
 */

const CLAVE = 'mev.sesion';

export interface SesionAficionado {
  token: string;
  expiresAt: string;
  fan: { id: string; email: string; displayName: string | null; loyaltyTier?: number };
}

export function guardarSesion(sesion: SesionAficionado): void {
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
  } catch {
    // Modo privado con almacenamiento bloqueado: la sesion durara solo lo que
    // dure la pagina. No es un error que deba interrumpir al usuario.
  }
}

export function leerSesion(): SesionAficionado | null {
  try {
    const bruto = window.sessionStorage.getItem(CLAVE);
    if (!bruto) return null;
    const sesion = JSON.parse(bruto) as SesionAficionado;
    if (!sesion?.token) return null;
    // Se descarta localmente una sesion ya caducada para no enviar peticiones
    // condenadas a 401.
    if (new Date(sesion.expiresAt).getTime() < Date.now()) {
      borrarSesion();
      return null;
    }
    return sesion;
  } catch {
    return null;
  }
}

export function borrarSesion(): void {
  try {
    window.sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada que hacer */
  }
}
