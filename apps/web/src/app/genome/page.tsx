import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { GenomePanel } from './GenomePanel';

export default async function GenomePage() {
  const session = await currentSession();
  if (!session) redirect('/login?next=/genome');

  return (
    <main className="page-wide">
      <p>
        <Link href="/" className="backlink">← Home</Link>
      </p>
      <h1>Persuasion Genome</h1>
      <p className="muted">
        Winning copy, stored as tagged structural components — not blobs. Feed it swipes;
        generators retrieve the DNA.
      </p>
      <GenomePanel />
    </main>
  );
}
