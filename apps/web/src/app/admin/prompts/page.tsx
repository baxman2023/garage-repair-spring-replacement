import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { PromptsAdmin } from './PromptsAdmin';

export default async function PromptsAdminPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/admin/prompts');
  if (!session.user.isPlatformAdmin) {
    return (
      <main>
        <h1>Admin</h1>
        <p className="alert alert-danger">Platform administrators only.</p>
        <p>
          <Link href="/" className="backlink">← Back</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <p>
        <Link href="/" className="backlink">← Back</Link>
      </p>
      <h1>Prompt registry</h1>
      <p className="muted">
        Prompts are immutable, versioned, and pinned to assets at generation — bumping a
        version never changes an existing asset unless it&apos;s explicitly upgraded.
      </p>
      <PromptsAdmin />
    </main>
  );
}
