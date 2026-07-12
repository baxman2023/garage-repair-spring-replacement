import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TRPCProvider } from '@/trpc/Provider';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'CopyForge',
  description: 'Multi-tenant direct-response funnel generation.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>
          <AppShell>{children}</AppShell>
        </TRPCProvider>
      </body>
    </html>
  );
}
