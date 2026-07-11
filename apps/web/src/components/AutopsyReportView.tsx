import type { AutopsyReport } from '@copyforge/core';

/**
 * Pure report renderer (WO-047) — shared by the workspace view and the
 * public share/print view, so both always show the same teardown.
 */

const section = { marginBottom: '1.25rem' } as const;
const h2 = { margin: '0 0 0.4rem', fontSize: 18 } as const;
const muted = { color: 'var(--muted)' } as const;
const card = {
  padding: '0.6rem 0.8rem',
  borderRadius: 8,
  border: '1px solid #333',
  background: '#12151c',
  marginBottom: '0.4rem',
  fontSize: 14,
} as const;

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'salmon',
  major: 'orange',
  minor: 'var(--muted)',
};

export function AutopsyReportView({ report }: { report: AutopsyReport }) {
  const meanScore =
    Object.values(report.council_scores).reduce((s, l) => s + l.score, 0) /
    Object.values(report.council_scores).length;

  return (
    <div>
      <section style={section}>
        <h2 style={h2}>Council scores — aggregate {meanScore.toFixed(0)}/100</h2>
        {Object.entries(report.council_scores).map(([lens, r]) => (
          <div key={lens} style={card}>
            <strong style={{ textTransform: 'capitalize' }}>{lens}</strong> — {r.score}/100{' '}
            <span style={muted}>{r.note}</span>
          </div>
        ))}
      </section>

      <section style={section}>
        <h2 style={h2}>Persuasion sequence map</h2>
        <ol style={{ paddingLeft: '1.4rem', margin: 0 }}>
          {report.persuasion_map.map((b, i) => (
            <li key={i} style={{ marginBottom: '0.4rem', fontSize: 14 }}>
              <strong>{b.beat}</strong> <span style={muted}>({b.page.replace(/_/g, ' ')} · {b.technique})</span>
              <div style={muted}>{b.note}</div>
            </li>
          ))}
        </ol>
      </section>

      <section style={section}>
        <h2 style={h2}>Awareness / sophistication mismatch</h2>
        <div style={card}>
          Audience is <strong>{report.mismatch.audience_awareness}-aware</strong>; the funnel writes to{' '}
          <strong>{report.mismatch.funnel_assumes}-aware</strong>. Market sophistication stage{' '}
          <strong>{report.mismatch.sophistication_market}</strong>; the copy behaves like stage{' '}
          <strong>{report.mismatch.sophistication_copy}</strong>.
          <div style={{ marginTop: '0.4rem' }}>{report.mismatch.diagnosis}</div>
        </div>
      </section>

      <section style={section}>
        <h2 style={h2}>Proof gaps ({report.proof_gaps.length})</h2>
        {report.proof_gaps.map((g, i) => (
          <div key={i} style={card}>
            <span style={{ color: SEVERITY_COLOR[g.severity], fontWeight: 600, textTransform: 'uppercase', fontSize: 11 }}>
              {g.severity}
            </span>{' '}
            “{g.claim}” <div style={muted}>{g.gap}</div>
          </div>
        ))}
        {report.proof_gaps.length === 0 && <p style={muted}>No unproven material claims found.</p>}
      </section>

      <section style={section}>
        <h2 style={h2}>Offer critique</h2>
        <div style={card}>
          <div><strong>Strengths:</strong> {report.offer_critique.strengths.join('; ') || '—'}</div>
          <div><strong>Weaknesses:</strong> {report.offer_critique.weaknesses.join('; ') || '—'}</div>
          <div style={{ marginTop: '0.4rem' }}>{report.offer_critique.verdict}</div>
        </div>
      </section>

      <section style={section}>
        <h2 style={h2}>Rewrite priorities</h2>
        <ol style={{ paddingLeft: '1.4rem', margin: 0 }}>
          {report.rewrite_priorities.map((p) => (
            <li key={p.rank} style={{ marginBottom: '0.4rem', fontSize: 14 }}>
              <strong>{p.target}</strong>
              <div style={muted}>{p.why}</div>
              <div style={muted}>Expected impact: {p.expected_impact}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
