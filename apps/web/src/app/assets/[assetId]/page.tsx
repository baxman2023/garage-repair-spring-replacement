import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { AssetEditor } from './AssetEditor';

export default async function AssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/assets/${assetId}`);

  return (
    <main style={{ maxWidth: 1000 }}>
      <p>
        <Link href="/projects">← Projects</Link>
      </p>
      <h1>Asset editor</h1>
      <AssetEditor assetId={assetId} />
    </main>
  );
}
