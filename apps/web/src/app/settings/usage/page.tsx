import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { UsagePanel } from './UsagePanel';

export default async function UsagePage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/settings/usage');
  if (!session.session.activeWorkspaceId) redirect('/');

  return (
    <main style={{ maxWidth: 1000 }}>
      <p>
        <Link href="/settings/billing">← Billing</Link>
      </p>
      <h1>Usage & cost</h1>
      <p style={{ color: 'var(--muted)' }}>
        Every model call runs on your own Anthropic key. These numbers sum directly
        from the usage ledger — token by token.
      </p>
      <UsagePanel />
    </main>
  );
}
