import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { DashboardPanel } from './DashboardPanel';

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/dashboard`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1100 }}>
      <p>
        <Link href={`/projects/${id}/predictions`}>← Predictions</Link>
      </p>
      <h1>Ledger dashboard</h1>
      <p style={{ color: 'var(--muted)' }}>
        Everything the event stream knows: the funnel by market, VSL retention, control
        history, the challenger queue, and how well the system forecasts itself.
      </p>
      <DashboardPanel projectId={id} />
    </main>
  );
}
