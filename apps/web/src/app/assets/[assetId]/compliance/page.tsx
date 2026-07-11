import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { CompliancePanel } from './CompliancePanel';

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/assets/${assetId}/compliance`);

  return (
    <main style={{ maxWidth: 1000 }}>
      <p>
        <Link href={`/assets/${assetId}/claims`}>← Claims (proof linker)</Link>
      </p>
      <h1>Compliance pre-flight — G6</h1>
      <p style={{ color: 'var(--muted)' }}>
        FTC, health/finance mode, and Meta/Google ad-policy rule packs with line refs. Errors
        and strict-mode claim failures always block; lint warnings may be acknowledged — with
        a reason, on the record.
      </p>
      <CompliancePanel assetId={assetId} />
    </main>
  );
}
