import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { FocusReport } from './FocusReport';

export default async function FocusGroupPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/assets/${assetId}/focus`);

  return (
    <main style={{ maxWidth: 1000 }}>
      <p>
        <Link href={`/assets/${assetId}/council`}>← Council (G3)</Link>
      </p>
      <h1>Synthetic Focus Group — G4</h1>
      <p style={{ color: 'var(--muted)' }}>
        Twenty cold-traffic personas read the draft before a dollar is spent. Attention drops and
        disbelief spikes anchor to the exact blocks that caused them.
      </p>
      <FocusReport assetId={assetId} />
    </main>
  );
}
