import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { DeliveryPanel } from './DeliveryPanel';

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/delivery`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1200 }}>
      <p>
        <Link href={`/projects/${id}/gates`}>← Gate dashboard</Link>
        {' · '}
        <Link href={`/projects/${id}/quiz`}>Quiz builder</Link>
      </p>
      <h1>Delivery Center</h1>
      <p style={{ color: 'var(--muted)' }}>
        Everything you need to take the build to market, in one place: packages, files,
        build prompts, quiz links, the message-match snippet — and what to do next for
        every asset.
      </p>
      <DeliveryPanel projectId={id} />
    </main>
  );
}
