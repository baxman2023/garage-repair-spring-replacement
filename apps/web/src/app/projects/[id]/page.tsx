import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { IntakeWorkbench } from './IntakeWorkbench';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 860 }}>
      <p>
        <Link href="/projects">← Projects</Link>
      </p>
      <h1>{project.name}</h1>
      <p style={{ color: 'var(--muted)' }}>
        Sales Detective intake — feed it everything you have, answer what it can’t find.
      </p>
      <IntakeWorkbench projectId={id} />
    </main>
  );
}
