import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { BuildPanel } from './BuildPanel';

export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/build`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main className="page-xl">
      <p>
        <Link href={`/projects/${id}/review`} className="backlink">← Strategy Review</Link>
      </p>
      <h1>Build — full funnel fan-out</h1>
      <p className="muted">
        One click builds every asset for every approved market, in cache-optimal order (all of
        market one, then market two…). Kill it, cancel it, resume it — steps never regenerate
        what already exists.
      </p>
      <BuildPanel projectId={id} />
    </main>
  );
}
