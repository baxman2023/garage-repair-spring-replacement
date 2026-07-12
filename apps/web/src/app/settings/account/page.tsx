import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { AccountPanel } from './AccountPanel';

export default async function AccountPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/settings/account');

  return (
    <main style={{ maxWidth: 640 }}>
      <p>
        <Link href="/" className="backlink">← Home</Link>
      </p>
      <h1>Account</h1>
      <p className="muted">
        Signed in as <code>{session.user.email}</code>
      </p>
      <AccountPanel />
    </main>
  );
}
