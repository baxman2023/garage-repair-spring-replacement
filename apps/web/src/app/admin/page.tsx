import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { AdminPanel } from './AdminPanel';

export default async function AdminPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/admin');
  if (!session.user.isPlatformAdmin) {
    return (
      <main>
        <h1>Admin</h1>
        <p style={{ color: 'salmon' }}>Platform administrators only.</p>
        <p>
          <Link href="/">← Back</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100 }}>
      <p>
        <Link href="/">← Back</Link> · <Link href="/admin/prompts">Prompt registry →</Link>
      </p>
      <h1>Platform admin</h1>
      <AdminPanel />
    </main>
  );
}
