import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TRPCProvider } from '@/trpc/Provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'CopyForge',
  description: 'Multi-tenant direct-response funnel generation.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
        <footer
          style={{
            marginTop: '3rem',
            padding: '1rem',
            borderTop: '1px solid #262a33',
            fontSize: 12,
            color: 'var(--muted)',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <a href="/legal/terms">Terms of Service</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/docs">Docs</a>
          <a href="/demo">Sample funnel</a>
          <span>Your copy is yours — full commercial rights, no watermarks.</span>
        </footer>
      </body>
    </html>
  );
}
