import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { PromptsPanel } from './PromptsPanel';

export default async function PromptsPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/assets/${assetId}/prompts`);

  return (
    <main style={{ maxWidth: 1000 }}>
      <p>
        <Link href={`/assets/${assetId}/compliance`}>← Compliance (G6)</Link>
      </p>
      <h1>Build prompts — Macaly & universal</h1>
      <p style={{ color: 'var(--muted)' }}>
        One-shot build prompts compiled from the Page Build Package. Copy verbatim into
        Macaly or any capable model — the copy blocks inside are final and fenced.
      </p>
      <PromptsPanel assetId={assetId} />
    </main>
  );
}
