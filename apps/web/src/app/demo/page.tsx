import Link from 'next/link';
import { DEMO_MARKETS, DEMO_PRODUCT } from './demoData';

/**
 * Read-only sample project (WO-054): a finished 5-market build a new user can
 * study before spending a token. Public and static — there is nothing to
 * mutate here.
 */

const box = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
} as const;

export default function DemoPage() {
  return (
    <main style={{ maxWidth: 980 }}>
      <p>
        <Link href="/">← App</Link> · <Link href="/docs/getting-started">How to build yours →</Link>
      </p>
      <h1>Sample funnel (read-only)</h1>
      <p style={{ color: 'var(--muted)' }}>
        A finished 5-market build for the fixture product. Every asset below passed the
        full gate ladder — G3 Council through G7 packaging. Your build follows the same
        path with your product.
      </p>

      <section style={{ ...box, marginBottom: '1rem', fontSize: 14 }}>
        <strong>{DEMO_PRODUCT.name}</strong>
        <div style={{ color: 'var(--muted)', marginTop: 4 }}>Approved offer (G0): {DEMO_PRODUCT.offer}</div>
        <div style={{ color: 'var(--muted)' }}>{DEMO_PRODUCT.math}</div>
      </section>

      {DEMO_MARKETS.map((m) => (
        <section key={m.rank} style={{ ...box, marginBottom: '0.9rem' }}>
          <h2 style={{ margin: '0 0 0.2rem', fontSize: 17 }}>
            #{m.rank} {m.label}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 0.6rem' }}>
            {m.awareness}-aware · sophistication {m.sophistication} · entry: {m.entryConversation}
          </p>
          {m.assets.map((a) => (
            <div key={a.type} style={{ borderTop: '1px solid #262a33', padding: '0.5rem 0', fontSize: 14 }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ textTransform: 'capitalize' }}>{a.type.replace(/_/g, ' ')}</strong>
                <span style={{ color: 'var(--ok)', fontSize: 12 }}>
                  {Object.keys(a.gates).map((g) => `${g} ✓`).join(' ')}
                </span>
              </div>
              <div>{a.headline}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{a.excerpt}</div>
            </div>
          ))}
        </section>
      ))}

      <p style={{ color: 'var(--muted)' }}>
        Ready to run this on your product? <Link href="/projects">Create a project</Link> and
        follow the checklist — <Link href="/docs/getting-started">the first funnel ships today</Link>.
      </p>
    </main>
  );
}
