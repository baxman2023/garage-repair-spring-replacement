import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { AutopsyListPanel } from './AutopsyListPanel';

export default async function AutopsyIndexPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/autopsy');
  if (!session.session.activeWorkspaceId) redirect('/');

  return (
    <main>
      <p>
        <Link href="/" className="backlink">← Projects</Link>
      </p>
      <h1>Autopsy Mode</h1>
      <p className="muted">
        Tear down any funnel — paste each page or point at a URL, and the Council of
        Copywriters returns a scored teardown: the persuasion map, the awareness
        mismatch, every proof gap, the offer verdict, and what to rewrite first.
      </p>
      <AutopsyListPanel />
    </main>
  );
}
