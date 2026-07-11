import type { NextRequest } from 'next/server';
import { readCappedJson } from '@/server/publicBody';
import { recordQuizAnswer } from '@copyforge/db';
import { corsJson, corsOptions } from '../cors';

/** Public: record one answer for a session. */

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const capped = await readCappedJson(req);
  const body = (capped.ok ? capped.body : null) as null | {
    sessionRef?: string;
    questionId?: string;
    optionId?: string;
  } | null;
  if (!body?.sessionRef || !body.questionId || !body.optionId) {
    return corsJson({ error: 'sessionRef, questionId, and optionId are required.' }, 400);
  }
  try {
    const ok = await recordQuizAnswer({
      slug,
      sessionRef: body.sessionRef,
      questionId: body.questionId,
      optionId: body.optionId,
    });
    if (!ok) return corsJson({ error: 'Unknown quiz.' }, 404);
    return corsJson({ ok: true });
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : 'Bad answer.' }, 400);
  }
}

export function OPTIONS() {
  return corsOptions();
}
