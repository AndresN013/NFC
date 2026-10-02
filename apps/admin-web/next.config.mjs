/**
 * Configuracion de Next para el panel administrativo.
 *
 * Las llamadas del navegador NO van directas a la API: pasan por este servidor
 * (`/api/upstream/...` -> `<API_ORIGIN>/api/v1/...`). El puente vive en
 * `src/app/api/upstream/[...ruta]/route.ts`, no aqui: un `rewrite` declarado en
 * esta configuracion se resuelve al construir y dejaba la direccion de la API
 * congelada en la imagen.
 *
 * Nota: el panel importa `@mev/domain/browser`, la superficie del dominio libre
 * de dependencias de Node. Antes se recortaba `node:crypto` del paquete con un
 * parche de webpack; el punto de entrada dedicado es preferible porque convierte
 * un import indebido en un error de compilacion en lugar de un sustituto vacio
 * que falla en tiempo de ejecucion.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El lint del monorepo se ejecuta aparte; que un aviso de estilo no rompa el build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
