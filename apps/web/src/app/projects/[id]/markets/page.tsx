import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { MarketsPanel } from './MarketsPanel';

export default async function MarketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/markets`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 900 }}>
      <p>
        <Link href={`/projects/${id}/math`}>← Funnel Math</Link>
      </p>
      <h1>Market Selection</h1>
      <p style={{ color: 'var(--muted)' }}>
        The engine proposes 8–12 crowds and keeps the top five by starving-crowd score. Swap,
        edit, or add your own — your edits survive re-runs.
      </p>
      <MarketsPanel projectId={id} />
    </main>
  );
}
