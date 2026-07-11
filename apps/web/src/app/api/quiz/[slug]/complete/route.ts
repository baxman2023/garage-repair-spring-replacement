import type { NextRequest } from 'next/server';
import { completeQuizSession } from '@copyforge/db';
import { corsJson, corsOptions } from '../cors';

/**
 * Public: complete a session — server-side scoring, lead persistence, ledger
 * events, CRM webhook enqueue. Returns the routed band's results copy or the
 * decline-with-dignity page.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    sessionRef?: string;
    contact?: Record<string, string>;
    answers?: Record<string, string>;
  } | null;
  if (!body?.sessionRef) return corsJson({ error: 'sessionRef is required.' }, 400);
  try {
    const result = await completeQuizSession({
      slug,
      sessionRef: body.sessionRef,
      contact: body.contact ?? {},
      answers: body.answers,
    });
    return corsJson(result);
  } catch (err) {
    return corsJson({ error: err instanceof Error ? err.message : 'Completion failed.' }, 400);
  }
}

export function OPTIONS() {
  return corsOptions();
}
