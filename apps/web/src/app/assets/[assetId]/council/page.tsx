import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/session';
import { CouncilReport } from './CouncilReport';

export default async function CouncilReportPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=/assets/${assetId}/council`);

  return (
    <main className="page-wide">
      <p>
        <Link href="/projects" className="backlink">
          ← Projects
        </Link>
      </p>
      <h1>Council report — G3</h1>
      <CouncilReport assetId={assetId} />
    </main>
  );
}
