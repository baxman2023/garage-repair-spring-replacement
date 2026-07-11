import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAutopsy } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { AutopsyDetailPanel } from './AutopsyDetailPanel';

export default async function AutopsyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/autopsy/${id}`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const row = await getAutopsy(workspaceId, id);
  if (!row) notFound();

  return (
    <main style={{ maxWidth: 900 }}>
      <p>
        <Link href="/autopsy">← Autopsies</Link>
      </p>
      <h1>{row.title}</h1>
      <AutopsyDetailPanel autopsyId={id} />
    </main>
  );
}
