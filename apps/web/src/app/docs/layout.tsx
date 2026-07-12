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
    <main>
      <nav className="row-lg small" style={{ marginBottom: '1rem' }}>
        <Link href="/" className="backlink">← App</Link>
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href}>
            {p.label}
          </Link>
        ))}
      </nav>
      <article>{children}</article>
    </main>
  );
}
