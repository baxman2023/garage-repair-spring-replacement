import type { AutopsyReport } from '@copyforge/core';

/**
 * Pure report renderer (WO-047) — shared by the workspace view and the
 * public share/print view, so both always show the same teardown.
 */

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'badge badge-danger',
  major: 'badge badge-warn',
  minor: 'badge',
};

export function AutopsyReportView({ report }: { report: AutopsyReport }) {
  const meanScore =
    Object.values(report.council_scores).reduce((s, l) => s + l.score, 0) /
    Object.values(report.council_scores).length;

  return (
    <div className="stack-lg">
      <section>
        <h2 style={{ margin: '0 0 0.4rem' }}>Council scores — aggregate {meanScore.toFixed(0)}/100</h2>
        {Object.entries(report.council_scores).map(([lens, r]) => (
          <div key={lens} className="card" style={{ marginBottom: '0.4rem' }}>
            <strong style={{ textTransform: 'capitalize' }}>{lens}</strong> — {r.score}/100{' '}
            <span className="muted">{r.note}</span>
          </div>
        ))}
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem' }}>Persuasion sequence map</h2>
        <ol style={{ paddingLeft: '1.4rem', margin: 0 }}>
          {report.persuasion_map.map((b, i) => (
            <li key={i} style={{ marginBottom: '0.4rem' }}>
              <strong>{b.beat}</strong> <span className="muted">({b.page.replace(/_/g, ' ')} · {b.technique})</span>
              <div className="muted">{b.note}</div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem' }}>Awareness / sophistication mismatch</h2>
        <div className="card">
          Audience is <strong>{report.mismatch.audience_awareness}-aware</strong>; the funnel writes to{' '}
          <strong>{report.mismatch.funnel_assumes}-aware</strong>. Market sophistication stage{' '}
          <strong>{report.mismatch.sophistication_market}</strong>; the copy behaves like stage{' '}
          <strong>{report.mismatch.sophistication_copy}</strong>.
          <div style={{ marginTop: '0.4rem' }}>{report.mismatch.diagnosis}</div>
        </div>
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem' }}>Proof gaps ({report.proof_gaps.length})</h2>
        {report.proof_gaps.map((g, i) => (
          <div key={i} className="card" style={{ marginBottom: '0.4rem' }}>
            <span className={SEVERITY_BADGE[g.severity]}>{g.severity}</span>{' '}
            “{g.claim}” <div className="muted">{g.gap}</div>
          </div>
        ))}
        {report.proof_gaps.length === 0 && <p className="muted">No unproven material claims found.</p>}
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem' }}>Offer critique</h2>
        <div className="card">
          <div><strong>Strengths:</strong> {report.offer_critique.strengths.join('; ') || '—'}</div>
          <div><strong>Weaknesses:</strong> {report.offer_critique.weaknesses.join('; ') || '—'}</div>
          <div style={{ marginTop: '0.4rem' }}>{report.offer_critique.verdict}</div>
        </div>
      </section>

      <section>
        <h2 style={{ margin: '0 0 0.4rem' }}>Rewrite priorities</h2>
        <ol style={{ paddingLeft: '1.4rem', margin: 0 }}>
          {report.rewrite_priorities.map((p) => (
            <li key={p.rank} style={{ marginBottom: '0.4rem' }}>
              <strong>{p.target}</strong>
              <div className="muted">{p.why}</div>
              <div className="muted">Expected impact: {p.expected_impact}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
