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
      <main>
        <h1>CopyForge</h1>
        <p style={{ color: 'var(--muted)' }}>
          Multi-tenant persuasion system — interrogates an offer, selects markets, generates
          and gates a complete direct-response funnel, and closes the loop on real
          performance.
        </p>
        <p>
          <Link href="/login">Sign in →</Link>
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
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{workspace?.name ?? 'CopyForge'}</h1>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            style={{ padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid #333', background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </form>
      </div>
      <p style={{ color: 'var(--muted)' }}>
        Signed in as <code>{session.user.email}</code> ({membership?.role ?? 'member'}) ·{' '}
        <Link href="/projects">Projects</Link> ·{' '}
        <Link href="/genome">Genome</Link> ·{' '}
        <Link href="/settings/api-key">API key settings</Link> ·{' '}
        <Link href="/settings/account">Account</Link>
      </p>

      <h2>Members</h2>
      <ul>
        {members.map((m) => (
          <li key={m.userId}>
            <code>{m.email}</code> — {m.role}
          </li>
        ))}
      </ul>

      {membership?.role === 'owner' && (
        <>
          <h2>Invite a teammate</h2>
          <InviteForm />
        </>
      )}
    </main>
  );
}
