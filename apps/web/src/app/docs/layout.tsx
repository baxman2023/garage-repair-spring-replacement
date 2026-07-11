import Link from 'next/link';
import type { ReactNode } from 'react';

const PAGES = [
  { href: '/docs', label: 'Overview' },
  { href: '/docs/getting-started', label: 'Getting started' },
  { href: '/docs/sales-detective', label: 'Sales Detective' },
  { href: '/docs/gates', label: 'The gate ladder' },
  { href: '/docs/delivery', label: 'Delivery & export' },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: 820 }}>
      <nav style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: 13, marginBottom: '1rem' }}>
        <Link href="/">← App</Link>
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href}>
            {p.label}
          </Link>
        ))}
      </nav>
      <article style={{ lineHeight: 1.65 }}>{children}</article>
    </main>
  );
}
