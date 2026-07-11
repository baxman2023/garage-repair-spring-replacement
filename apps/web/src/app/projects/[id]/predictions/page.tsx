import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { PredictionsPanel } from './PredictionsPanel';

export default async function PredictionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/predictions`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1100 }}>
      <p>
        <Link href={`/projects/${id}/controls`}>← Controls</Link>
      </p>
      <h1>Predictions & calibration</h1>
      <p style={{ color: 'var(--muted)' }}>
        The system forecasts every approved asset's headline metric, scores itself with
        Brier once reality reports in, and recalibrates within hard bounds — priors ±20%,
        lens weights ±20%, quality floors never.
      </p>
      <PredictionsPanel projectId={id} />
    </main>
  );
}
