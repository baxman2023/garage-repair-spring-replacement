import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { FunnelMathPanel } from './FunnelMathPanel';

export default async function FunnelMathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/math`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main className="page-wide">
      <p className="no-print">
        <Link href={`/projects/${id}/offer`} className="backlink">← Offer Forge</Link>
      </p>
      <h1>Funnel Math — G1</h1>
      <p className="muted no-print">
        Kill uneconomic funnels before generation. A failing run hard-stops the pipeline and
        routes you back to the Offer Forge.
      </p>
      <FunnelMathPanel projectId={id} />
    </main>
  );
}
