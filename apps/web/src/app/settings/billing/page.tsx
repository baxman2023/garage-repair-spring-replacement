import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { BillingPanel } from './BillingPanel';

export default async function BillingPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/settings/billing');
  if (!session.session.activeWorkspaceId) redirect('/');

  return (
    <main>
      <p>
        <Link href="/settings/licensing" className="backlink">← Licensing & seats</Link>
      </p>
      <h1>Billing</h1>
      <p className="muted">
        Lifetime licenses at $1,000 per named seat, plus the optional Genome Feed
        subscription ($79/mo). Receipts appear here as Stripe confirms them.
      </p>
      <BillingPanel />
    </main>
  );
}
