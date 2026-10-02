/**
 * El navegador NUNCA llama a la API directamente: lo hace a traves de
 * `src/app/api/upstream/[...ruta]/route.ts`, que reenvia a `API_ORIGIN`. Asi la
 * web funciona desde cualquier dispositivo que alcance a este servidor sin que
 * la API tenga que estar expuesta ni que su origen entre en la lista blanca de
 * CORS.
 *
 * Ese puente era antes un `rewrite` declarado aqui. No servia: Next resuelve
 * los rewrites AL CONSTRUIR y los graba en el manifiesto, asi que la direccion
 * de la API quedaba congelada con el valor del build y la variable del
 * alojamiento se ignoraba.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Origenes autorizados a pedir recursos de desarrollo.
   *
   * En desarrollo, Next rechaza las peticiones que llegan con un `Host` distinto
   * del esperado. Un tunel (`cloudflared`, `ngrok`) entrega exactamente eso: el
   * telefono abre `https://algo.trycloudflare.com` y, sin esta lista, el servidor
   * de desarrollo rechaza los recursos y la pagina se queda a medias.
   *
   * Solo afecta a `next dev`. En produccion se sirve desde su propio dominio y
   * esta opcion no interviene.
   */
  allowedDevOrigins: [
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok.io',
    '*.loca.lt',
    // Toda la red local 192.168.x.x, para las pruebas por WiFi.
    '192.168.0.0/16',
  ],

  // @mev/ui y @mev/domain se publican como fuente TypeScript dentro del
  // monorepo; Next los transpila en lugar de consumir un `dist` precompilado.
  transpilePackages: ['@mev/ui', '@mev/domain'],
  poweredByHeader: false,
  eslint: {
    // El lint del monorepo se ejecuta desde la raiz, no en el build de Next.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Las paginas de verificacion no deben filtrar el token en el Referer
          // al navegar a un enlace externo.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
