import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { OfferForgePanel } from './OfferForgePanel';

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/offer`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1080 }}>
      <p>
        <Link href={`/projects/${id}`}>← {project.name}</Link>
      </p>
      <h1>Offer Forge — G0</h1>
      <p style={{ color: 'var(--muted)' }}>
        Diagnose and strengthen the offer before any copy is written. Nothing advances until a
        selected offer passes the G0 checklist.
      </p>
      <OfferForgePanel projectId={id} />
    </main>
  );
}
