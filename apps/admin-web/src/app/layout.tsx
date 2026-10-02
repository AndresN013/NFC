import type { Metadata, Viewport } from 'next';
import { SessionProvider } from '@/components/SessionProvider';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Panel administrativo · Marathon Escudo Vivo',
  description: 'Operación, producción, riesgo y privacidad de Marathon Escudo Vivo.',
  // El panel no debe aparecer en buscadores ni dejar rastro en enlaces salientes.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es">
      <body>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
