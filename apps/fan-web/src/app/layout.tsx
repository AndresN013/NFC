import type { Metadata, Viewport } from 'next';
import '@mev/ui/tokens.css';
import './globales.css';

/**
 * Raiz de la aplicacion. Solo `html`, `body` y los estilos globales.
 *
 * La navegacion del sitio vive en `(sitio)/layout.tsx`. La pantalla de escaneo
 * vive en `(escaneo)` y NO la lleva: cuando alguien acerca el telefono a su
 * camiseta no quiere un menu, quiere una respuesta.
 */

export const metadata: Metadata = {
  title: 'Marathon Escudo Vivo',
  description: 'Consulta la informacion de tu camiseta Marathon acercando el telefono al escudo.',
  // Cada URL lleva un identificador: no debe indexarse.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Se permite ampliar: bloquear el zoom rompe la accesibilidad.
  maximumScale: 5,
  themeColor: '#0b3d2e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
