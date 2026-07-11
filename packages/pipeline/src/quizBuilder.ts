import { z } from 'zod';
import {
  extractJsonObject,
  JOB_TYPES,
  parseMarketProfile,
  quizBandSchema,
  quizScoringSchema,
  simulateRouting,
  validateQuizDefinition,
  type QuizBand,
  type QuizDefinition,
  type QuizQuestion,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  getApprovedOffer,
  getCurrentProfile,
  getPrompt,
  listMarkets,
  saveQuizDefinition,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * Quiz builder (WO-039): generates the market-routing quiz from the five
 * diagnosed market profiles — 5–8 routing questions with per-option weights
 * into the market buckets (the model weights by RANK; we map ranks to market
 * ids), prequal budget/urgency questions with disqualification, per-band
 * results copy (that market's short-form letter + CTA), lead capture, and the
 * decline-with-dignity page. The ROUTING SIMULATOR is a hard gate: 1,000
 * deterministic synthetic answer sets must distribute to the intended buckets
 * before the definition persists.
 */

export const QUIZ_GENERATE_JOB = JOB_TYPES.quizGenerate;

const rankKey = z.string().regex(/^[1-5]$/);

const generatedQuizSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        kind: z.enum(['routing', 'prequal']),
        text: z.string().trim().min(1),
        options: z
          .array(
            z.object({
              id: z.string().trim().min(1),
              text: z.string().trim().min(1),
              weights: z.record(rankKey, z.number()).default({}),
              disqualify: z.boolean().default(false),
            }),
          )
          .min(2)
          .max(6),
      }),
    )
    .min(6),
  lead_capture: quizScoringSchema.shape.lead_capture,
  decline: quizScoringSchema.shape.decline,
  bands: z
    .array(
      z.object({
        rank: z.number().int().min(1).max(5),
        label: z.string().trim().min(1),
        result_blocks: quizBandSchema.shape.resultBlocks,
      }),
    )
    .length(5),
});

export function createQuizGenerateHandler(clientOptions: ClientOptions = {}) {
  const ai = createClient(clientOptions);

  return async function handleQuizGenerate(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    if (!projectId) throw new Error('quiz.generate job missing projectId');

    const prompt = await getPrompt('quiz.generate');
    if (!prompt) throw new Error('No active prompt "quiz.generate" — run the seed.');

    const markets = await listMarkets(job.workspaceId, projectId);
    if (markets.length !== 5) throw new Error('Quiz generation needs the 5 diagnosed markets (run strategy first).');
    const profiles = markets.map((m) => ({ rank: m.rank, id: m.id, profile: parseMarketProfile(m.profile) }));
    const productProfile = await getCurrentProfile(job.workspaceId, projectId);
    const offer = await getApprovedOffer(job.workspaceId, projectId);

    const result = await ai.generate({
      workspaceId: job.workspaceId,
      stage: 'asset_drafting',
      projectId,
      jobId: job.id,
      system: [{ text: prompt.body, cache: true }],
      messages: [
        {
          role: 'user',
          content: [
            `MARKETS (weight options by RANK number):\n${JSON.stringify(
              profiles.map((p) => ({ rank: p.rank, label: p.profile.label, avatar: p.profile.avatar, entry_conversation: p.profile.entry_conversation, core_desire: p.profile.core_desire })),
              null,
              2,
            )}`,
            `PRODUCT PROFILE:\n${JSON.stringify(productProfile?.profile ?? {}, null, 2)}`,
            `APPROVED OFFER:\n${JSON.stringify(offer?.offer ?? {}, null, 2)}`,
            'Write the routing quiz as the JSON contract specifies.',
          ].join('\n\n'),
        },
      ],
    });

    const parsed = generatedQuizSchema.parse(extractJsonObject(result.text));

    // Ranks → market ids.
    const idByRank = new Map(profiles.map((p) => [String(p.rank), p.id]));
    const questions: QuizQuestion[] = parsed.questions.map((q) => ({
      ...q,
      options: q.options.map((o) => ({
        ...o,
        weights: Object.fromEntries(
          Object.entries(o.weights).map(([rank, w]) => {
            const marketId = idByRank.get(rank);
            if (!marketId) throw new Error(`Quiz option weights unknown market rank "${rank}".`);
            return [marketId, w];
          }),
        ),
      })),
    }));
    const bands: QuizBand[] = parsed.bands
      .sort((a, b) => a.rank - b.rank)
      .map((b) => ({
        id: `band-${b.rank}`,
        marketId: idByRank.get(String(b.rank))!,
        label: b.label,
        resultBlocks: b.result_blocks,
      }));

    const slug = `quiz-${projectId.slice(-8).toLowerCase()}`;
    const def: QuizDefinition = {
      slug,
      questions,
      scoring: { method: 'weighted_sum', lead_capture: parsed.lead_capture, decline: parsed.decline },
      bands,
    };

    validateQuizDefinition(def);

    // Acceptance gate: 1,000 synthetic answer sets must route as intended.
    const sim = simulateRouting(def, 1000);
    if (!sim.pass) {
      const worst = Object.entries(sim.perBucket)
        .map(([id, b]) => `${id}:${(b.hitRate * 100).toFixed(0)}%`)
        .join(' ');
      throw new Error(`Quiz routing simulation failed (need ≥70% per bucket): ${worst}; dq ${sim.disqualified.tagged}/${sim.disqualified.intended}.`);
    }

    const quizId = await saveQuizDefinition({
      workspaceId: job.workspaceId,
      projectId,
      slug,
      questions: def.questions,
      scoring: def.scoring,
      bands: def.bands,
    });

    // Forecast the quiz optin rate (WO-045) from the calibrated prior.
    const { recordQuizPrediction } = await import('@copyforge/db');
    await recordQuizPrediction({ workspaceId: job.workspaceId, quizDefinitionId: quizId });
  };
}
