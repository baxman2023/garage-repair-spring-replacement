import Link from 'next/link';
import { DEMO_MARKETS, DEMO_PRODUCT } from './demoData';

/**
 * Read-only sample project (WO-054): a finished 5-market build a new user can
 * study before spending a token. Public and static — there is nothing to
 * mutate here.
 */

export default function DemoPage() {
  return (
    <main className="page-wide">
      <p>
        <Link href="/" className="backlink">← App</Link> · <Link href="/docs/getting-started">How to build yours →</Link>
      </p>
      <h1>Sample funnel (read-only)</h1>
      <p className="muted">
        A finished 5-market build for the fixture product. Every asset below passed the
        full gate ladder — G3 Council through G7 packaging. Your build follows the same
        path with your product.
      </p>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <strong>{DEMO_PRODUCT.name}</strong>
        <div className="muted">Approved offer (G0): {DEMO_PRODUCT.offer}</div>
        <div className="muted">{DEMO_PRODUCT.math}</div>
      </section>

      {DEMO_MARKETS.map((m) => (
        <section key={m.rank} className="card" style={{ marginBottom: '0.9rem' }}>
          <h2>
            #{m.rank} {m.label}
          </h2>
          <p className="muted small">
            {m.awareness}-aware · sophistication {m.sophistication} · entry: {m.entryConversation}
          </p>
          {m.assets.map((a) => (
            <div key={a.type} style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 0' }}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <strong style={{ textTransform: 'capitalize' }}>{a.type.replace(/_/g, ' ')}</strong>
                <span className="ok xsmall">
                  {Object.keys(a.gates).map((g) => `${g} ✓`).join(' ')}
                </span>
              </div>
              <div>{a.headline}</div>
              <div className="muted small">{a.excerpt}</div>
            </div>
          ))}
        </section>
      ))}

      <p className="muted">
        Ready to run this on your product? <Link href="/projects">Create a project</Link> and
        follow the checklist — <Link href="/docs/getting-started">the first funnel ships today</Link>.
      </p>
    </main>
  );
}
