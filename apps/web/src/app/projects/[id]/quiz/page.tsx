import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { projects, tenantDb } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { QuizPanel } from './QuizPanel';

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/projects/${id}/quiz`);
  const workspaceId = session.session.activeWorkspaceId;
  if (!workspaceId) redirect('/');

  const project = await tenantDb(workspaceId).findFirst(projects, eq(projects.id, id));
  if (!project) notFound();

  return (
    <main style={{ maxWidth: 1100 }}>
      <p>
        <Link href={`/projects/${id}/gates`}>← Gate dashboard</Link>
      </p>
      <h1>Quiz builder — market router</h1>
      <p style={{ color: 'var(--muted)' }}>
        Five to eight discovery questions sort every respondent into a market bucket;
        prequal questions disqualify with dignity. The simulator proves the routing on a
        thousand synthetic respondents before anything ships.
      </p>
      <QuizPanel projectId={id} />
    </main>
  );
}
