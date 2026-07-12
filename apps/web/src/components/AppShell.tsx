'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { trpc } from '@/trpc/react';

function BrandMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Anvil silhouette with an ember spark. */}
      <path
        d="M4 9h9c3.5 0 6-1.4 7-3.5-1.8.2-3-.5-3-1.5H9v3H4v2zm3 2h6v3.5c0 1 .7 1.8 1.5 2.5h-9c.8-.7 1.5-1.5 1.5-2.5V11zm-2 7h12v2H5v-2z"
        fill="var(--accent)"
      />
      <circle cx="19.5" cy="9.5" r="1.3" fill="var(--warn)" />
    </svg>
  );
}

const NAV = [
  { href: '/projects', label: 'Projects' },
  { href: '/genome', label: 'Genome' },
  { href: '/docs', label: 'Docs' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

  // Public funnel pages get no app chrome — they're the user's product.
  if (pathname.startsWith('/q/')) return <>{children}</>;

  const signedIn = Boolean(me.data);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/" className="brand">
            <BrandMark />
            <span>
              Copy<span className="forge">Forge</span>
            </span>
          </Link>
          <nav className="nav">
            {signedIn &&
              NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathname.startsWith(item.href) ? 'active' : undefined}
                >
                  {item.label}
                </Link>
              ))}
          </nav>
          <div className="header-actions">
            {signedIn ? (
              <>
                <Link
                  href="/settings/account"
                  className="xsmall muted"
                  title="Account settings"
                  style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}
                >
                  {me.data?.user.email}
                </Link>
                <form action="/api/auth/logout" method="post" style={{ display: 'contents' }}>
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              me.isFetched && (
                <Link href="/login" className="btn btn-primary btn-sm">
                  Sign in
                </Link>
              )
            )}
          </div>
        </div>
      </header>

      {children}

      <footer className="app-footer">
        <div className="app-footer-inner">
          <a href="/legal/terms">Terms of Service</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/docs">Docs</a>
          <a href="/demo">Sample funnel</a>
          <span>Your copy is yours — full commercial rights, no watermarks.</span>
        </div>
      </footer>
    </>
  );
}
