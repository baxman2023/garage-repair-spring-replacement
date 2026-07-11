import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { IngestPanel } from './IngestPanel';

export default async function IngestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/ingest`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1100 }}>
      <p>
        <Link href={`/projects/${id}/delivery`}>← Delivery Center</Link>
      </p>
      <h1>Event ingestion</h1>
      <p style={{ color: 'var(--muted)' }}>
        Reality flows in here: Ringba calls, pixel events, email metrics. Duplicates
        collapse; anything unmapped parks in triage instead of vanishing.
      </p>
      <IngestPanel projectId={id} />
    </main>
  );
}
