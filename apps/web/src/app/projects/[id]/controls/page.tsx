import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { ControlsPanel } from './ControlsPanel';

export default async function ControlsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/controls`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main className="page-wide">
      <p>
        <Link href={`/projects/${id}/ingest`} className="backlink">← Event ingestion</Link>
      </p>
      <h1>Controls & challengers</h1>
      <p className="muted">
        The first approved asset per market and type holds the crown. Challengers are
        briefed from its recorded weaknesses and must beat it on real volume — the
        promotion heuristic is directional, not lab-grade, and it refuses thin data.
      </p>
      <ControlsPanel projectId={id} />
    </main>
  );
}
