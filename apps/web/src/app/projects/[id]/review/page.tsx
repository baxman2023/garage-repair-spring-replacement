import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { ReviewPanel } from './ReviewPanel';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/review`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1200 }}>
      <p>
        <Link href={`/projects/${id}/voc`}>← VOC</Link>
      </p>
      <h1>Strategy Review — G2</h1>
      <p style={{ color: 'var(--muted)' }}>
        The human checkpoint: five markets side by side. Approval snapshots the strategy —
        the build fan-out stays locked until it passes.
      </p>
      <ReviewPanel projectId={id} />
    </main>
  );
}
