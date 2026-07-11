import { notFound } from 'next/navigation';
import { getAutopsyByShareToken } from '@copyforge/db';
import { AutopsyReportView } from '@/components/AutopsyReportView';
import { PrintButton } from './PrintButton';

/**
 * PUBLIC shared autopsy (WO-047): token URL, read-only, revocable — the
 * flagship lead magnet. Revoking the token 404s this page immediately.
 * Print styles make the browser's Print → Save as PDF the export path.
 */

export const dynamic = 'force-dynamic';

export default async function SharedAutopsyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getAutopsyByShareToken(token);
  if (!view) notFound();

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          main { max-width: none !important; }
          body { background: #fff !important; color: #111 !important; }
        }
      `}</style>
      <header style={{ marginBottom: '1.25rem' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Funnel autopsy · read-only</span>
          <PrintButton />
        </div>
        <h1 style={{ margin: '0.4rem 0 0.2rem' }}>{view.title}</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          Council of Copywriters teardown · {view.createdAt.toISOString().slice(0, 10)}
        </p>
      </header>

      <AutopsyReportView report={view.report} />

      <footer className="no-print" style={{ marginTop: '2rem', padding: '1rem', borderRadius: 8, border: '1px solid #333', background: '#12151c' }}>
        <strong>Want this funnel rebuilt right?</strong>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0.4rem 0' }}>
          CopyForge generated this teardown — and it can regenerate the whole funnel from the
          same diagnosis: markets, offer, VSL, letter, quiz, emails, through six quality gates.
        </p>
        <a href="/" style={{ fontWeight: 600 }}>Rebuild it in CopyForge →</a>
      </footer>
    </main>
  );
}
