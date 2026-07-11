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
        <Link href="/">← Home</Link>
      </p>
      <h1>Projects</h1>
      <ProjectsPanel />
    </main>
  );
}
