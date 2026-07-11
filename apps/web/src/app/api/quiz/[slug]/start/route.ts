import type { NextRequest } from 'next/server';
import { getQuizBySlug, publicQuizView, startQuizSession } from '@copyforge/db';
import { corsJson, corsOptions } from '../cors';

/** Public: start a quiz session (emits quiz_start) and return the client-safe view. */

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { sessionRef?: string };
  const quiz = await getQuizBySlug(slug);
  if (!quiz) return corsJson({ error: 'Unknown quiz.' }, 404);
  const session = await startQuizSession({
    slug,
    sessionRef: typeof body.sessionRef === 'string' && body.sessionRef.length >= 8 ? body.sessionRef : undefined,
  });
  return corsJson({ sessionRef: session!.sessionRef, quiz: publicQuizView(quiz) });
}

export function OPTIONS() {
  return corsOptions();
}
