import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { ApiKeyPanel } from './ApiKeyPanel';

export default async function ApiKeysettingsPage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/settings/api-key');

  return (
    <main>
      <p>
        <Link href="/">← Back</Link>
      </p>
      <h1>Anthropic API key</h1>
      <p style={{ color: 'var(--muted)' }}>
        CopyForge uses your own Anthropic key (your key, your cost). It is encrypted at rest
        and never logged or echoed back to you.
      </p>
      <ApiKeyPanel />
    </main>
  );
}
