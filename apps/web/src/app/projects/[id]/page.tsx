import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { IntakeWorkbench } from './IntakeWorkbench';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main>
      <p>
        <Link href="/projects" className="backlink">← Projects</Link>
      </p>
      <h1>{project.name}</h1>
      <OnboardingChecklist projectId={id} />
      <p className="muted">
        Sales Detective intake — feed it everything you have, answer what it can’t find. Then
        continue to the <Link href={`/projects/${id}/offer`}>Offer Forge (G0) →</Link>
      </p>
      <IntakeWorkbench projectId={id} />
    </main>
  );
}
