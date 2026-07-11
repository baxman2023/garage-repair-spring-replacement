import { notFound } from 'next/navigation';
import { getQuizBySlug, publicQuizView } from '@copyforge/db';
import { QuizRuntime } from './QuizRuntime';

/** PUBLIC hosted quiz (WO-040): no auth — the funnel's front door. */

export default async function HostedQuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const quiz = await getQuizBySlug(slug);
  if (!quiz) notFound();
  const view = publicQuizView(quiz);

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <QuizRuntime slug={slug} questions={view.questions} leadCapture={view.lead_capture} />
    </main>
  );
}
