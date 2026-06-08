import './globals.css';
import type { Metadata } from 'next';
import { JetBrains_Mono, Syne } from 'next/font/google';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/layout/app-shell';

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-syne',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'ACDP Console',
  description: 'Orchestration and observability console for the Agent Context Distribution Protocol.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontClasses = `${syne.variable} ${jetBrainsMono.variable}`;
  return (
    <html lang="en" className={fontClasses}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
