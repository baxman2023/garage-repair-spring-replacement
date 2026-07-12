import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { VocPanel } from './VocPanel';

export default async function VocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/voc`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main className="page-wide">
      <p>
        <Link href={`/projects/${id}/markets`} className="backlink">← Markets</Link>
      </p>
      <h1>Voice of Customer</h1>
      <p className="muted">
        Feed each market real customer language — reviews, threads, comments. Generators quote
        this corpus verbatim.
      </p>
      <VocPanel projectId={id} />
    </main>
  );
}
