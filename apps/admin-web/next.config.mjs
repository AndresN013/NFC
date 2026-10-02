/**
 * Configuracion de Next para el panel administrativo.
 *
 * Las llamadas del navegador NO van directas a la API: se reescriben a traves
 * de este servidor (`/api/upstream/...` -> `<API>/api/v1/...`). Dos razones:
 *
 *  1. La API solo expone `x-export-truncated` como cabecera de respuesta normal.
 *     En una peticion cruzada el navegador no deja leer cabeceras que no esten
 *     en `Access-Control-Expose-Headers`, asi que una exportacion truncada
 *     pasaria por completa. Al ser mismo origen, la cabecera se lee siempre.
 *  2. Evita depender de la lista blanca de CORS para que el panel funcione.
 *
 * El token sigue viajando en `Authorization`, que la reescritura reenvia tal cual.
 *
 * Nota: el panel importa `@mev/domain/browser`, la superficie del dominio libre
 * de dependencias de Node. Antes se recortaba `node:crypto` del paquete con un
 * parche de webpack; el punto de entrada dedicado es preferible porque convierte
 * un import indebido en un error de compilacion en lugar de un sustituto vacio
 * que falla en tiempo de ejecucion.
 */

/** URL interna de la API. Solo la usa el servidor de Next. */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El lint del monorepo se ejecuta aparte; que un aviso de estilo no rompa el build.
  eslint: { ignoreDuringBuilds: true },

  async rewrites() {
    return [
      {
        source: '/api/upstream/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
