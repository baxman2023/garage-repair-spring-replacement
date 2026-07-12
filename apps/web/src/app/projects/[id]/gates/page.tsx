import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { GatesPanel } from './GatesPanel';

export default async function GatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/gates`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main className="page-xl">
      <p>
        <Link href={`/projects/${id}/build`} className="backlink">← Build</Link>
      </p>
      <h1>Gate dashboard</h1>
      <p className="muted">
        Every asset × every gate, live. Drill into any report; owners can block, approve, or
        override — always with a reason, always on the audit record.
      </p>
      <GatesPanel projectId={id} />
    </main>
  );
}
