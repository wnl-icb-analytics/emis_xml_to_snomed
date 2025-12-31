import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import LayoutWrapper from '@/components/layout-wrapper';
import { AppModeProvider } from '@/contexts/AppModeContext';
import { SettingsProvider } from '@/contexts/SettingsContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'EMIS XML SNOMED Analyser',
  description:
    'Analyse EMIS XML exports and expand SNOMED codes using terminology server',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SettingsProvider>
          <AppModeProvider>
            <LayoutWrapper>{children}</LayoutWrapper>
            <Toaster />
          </AppModeProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
