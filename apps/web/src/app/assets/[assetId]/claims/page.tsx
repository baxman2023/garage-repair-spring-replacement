import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { ClaimsPanel } from './ClaimsPanel';

export default async function ClaimsPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/assets/${assetId}/claims`);

  return (
    <main className="page-wide">
      <p>
        <Link href={`/assets/${assetId}/focus`} className="backlink">
          ← Focus Group (G4)
        </Link>
      </p>
      <h1>Claims inventory — proof linker</h1>
      <p className="muted">
        Every claim proven or flagged. Attach a proof asset to resolve a flag; in health or
        finance mode, G6 fails closed while any flag remains. Resolutions survive
        regeneration by text-similarity rematch.
      </p>
      <ClaimsPanel assetId={assetId} />
    </main>
  );
}
