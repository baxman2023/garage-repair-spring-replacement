import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb, workspaces } from '@copyforge/db';
import { currentSession } from '@/server/auth/session';
import { getMembership, listMembers } from '@/server/auth/service';
import { HealthCheck } from './HealthCheck';
import { InviteForm } from './InviteForm';

export default async function HomePage() {
  const session = await currentSession();

  if (!session) {
    return (
      <main style={{ paddingTop: '5rem', textAlign: 'center', maxWidth: 640 }}>
        <p className="eyebrow">Direct-response funnel generation</p>
        <h1 style={{ fontSize: '2.3rem', margin: '0.75rem 0' }}>
          Forge complete funnels from a single offer dump.
        </h1>
        <p className="muted" style={{ fontSize: 16 }}>
          CopyForge interrogates your offer, selects the hungriest markets, generates and
          quality-gates every asset of a direct-response funnel — then closes the loop on real
          performance.
        </p>
        <p className="row" style={{ justifyContent: 'center', marginTop: '1.5rem' }}>
          <Link href="/login" className="btn btn-primary">
            Sign in →
          </Link>
          <Link href="/demo" className="btn">
            See a sample build
          </Link>
        </p>
        <HealthCheck />
      </main>
    );
  }

  const workspaceId = session.session.activeWorkspaceId;
  const wsRows = workspaceId
    ? await getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    : [];
  const workspace = wsRows[0];
  const membership = workspaceId ? await getMembership(workspaceId, session.user.id) : null;
  const members = workspaceId ? await listMembers(workspaceId) : [];

  return (
    <main className="page-wide">
      <p className="eyebrow">Workspace</p>
      <h1>{workspace?.name ?? 'CopyForge'}</h1>
      <p className="muted">
        Signed in as <code>{session.user.email}</code> ({membership?.role ?? 'member'})
      </p>

      <div className="row" style={{ margin: '1.25rem 0 2rem' }}>
        <Link href="/projects" className="btn btn-primary">
          Projects →
        </Link>
        <Link href="/genome" className="btn">
          Genome
        </Link>
        <Link href="/settings/api-key" className="btn">
          API key
        </Link>
        <Link href="/settings/licensing" className="btn">
          Licensing
        </Link>
        <Link href="/settings/account" className="btn">
          Account
        </Link>
      </div>

      <section className="card">
        <h2>Members</h2>
        <ul className="plain stack-sm">
          {members.map((m) => (
            <li key={m.userId} className="spread">
              <code>{m.email}</code>
              <span className="badge">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {membership?.role === 'owner' && (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>Invite a teammate</h2>
          <InviteForm />
        </section>
      )}
    </main>
  );
}
