import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { LicensingPanel } from './LicensingPanel';

export default async function LicensingPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/settings/licensing');
  if (!session.session.activeWorkspaceId) redirect('/');

  return (
    <main>
      <p>
        <Link href="/" className="backlink">← Projects</Link>
      </p>
      <h1>Licensing & seats</h1>
      <p className="muted">
        CopyForge is licensed per named user. Every teammate who works in this
        workspace needs a seat on an active license.
      </p>
      <LicensingPanel />
    </main>
  );
}
