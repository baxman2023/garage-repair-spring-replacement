import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { ProjectsPanel } from './ProjectsPanel';

export default async function ProjectsPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/projects');

  return (
    <main>
      <p>
        <Link href="/" className="backlink">
          ← Home
        </Link>
      </p>
      <h1>Projects</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Each project is one offer, interrogated and forged into a complete funnel.
      </p>
      <ProjectsPanel />
    </main>
  );
}
