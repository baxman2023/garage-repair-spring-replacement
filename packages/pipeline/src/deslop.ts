import { z } from 'zod';
import {
  DEFAULT_DESLOP_CONFIG,
  evaluateDeslop,
  extractJsonObject,
  findInventedNumbers,
  JOB_TYPES,
  measureDeslop,
  SPOKEN_ASSET_TYPES,
  type AssetBlock,
  type DeslopConfig,
  type DeslopVerdict,
} from '@copyforge/core';
import { createClient, type ClientOptions } from '@copyforge/ai';
import {
  getAsset,
  getCurrentAssetVersion,
  getCurrentProfile,
  getPrompt,
  insertAssetVersion,
  listClaims,
  listMarketPhrases,
  recordAssetGate,
  setAssetStatus,
  type ClaimedJob,
} from '@copyforge/db';

/**
 * De-Slop Gate — G5 (WO-030). Deterministic measures (FK grade band,
 * AI-tell scrub, specificity density, sentence rhythm) plus an AI voice-match
 * score when founder samples exist. Failing dimensions drive a TARGETED
 * rewrite loop; the specificity injector is fenced by the invented-numbers
 * guard — a rewrite may only use numbers already in the draft/profile/VOC/
 * claims corpus. Pass → compliance; exhausted loops → blocked.
 */

export const ASSET_DESLOP_JOB = JOB_TYPES.assetDeslop;

const voiceResultSchema = z.object({
  style_card: z.object({
    tone: z.string().default(''),
    sentence_habits: z.string().default(''),
    signature_phrases: z.array(z.string()).default([]),
    never_says: z.array(z.string()).default([]),
  }),
  match_score: z.number().min(0).max(100),
  notes: z.string().default(''),
});
export type StyleCard = z.infer<typeof voiceResultSchema>['style_card'];

const rewrittenBlocksSchema = z.object({
  blocks: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.string().min(1),
        text: z.string().min(1),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});

function fullText(blocks: AssetBlock[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

function renderBlocks(blocks: AssetBlock[]): string {
  return blocks.map((b) => `[block ${b.id} · ${b.role}]\n${b.text}`).join('\n\n');
}

export function createDeslopHandler(
  clientOptions: ClientOptions = {},
  config: DeslopConfig = DEFAULT_DESLOP_CONFIG,
) {
  const ai = createClient(clientOptions);

  return async function handleDeslop(job: ClaimedJob): Promise<void> {
    const projectId = String(job.payload.projectId ?? '');
    const assetId = String(job.payload.assetId ?? '');
    const marketId = String(job.payload.marketId ?? '');
    if (!projectId || !assetId || !marketId) {
      throw new Error('asset.deslop job missing projectId/assetId/marketId');
    }

    const rewritePrompt = await getPrompt('deslop.rewrite');
    if (!rewritePrompt) throw new Error('No active prompt "deslop.rewrite" — run the seed.');
    const voicePrompt = await getPrompt('deslop.voice');
    if (!voicePrompt) throw new Error('No active prompt "deslop.voice" — run the seed.');

    const asset = await getAsset(job.workspaceId, assetId);
    if (!asset) throw new Error('Asset not found.');
    const spoken = SPOKEN_ASSET_TYPES.has(asset.type);

    let version = await getCurrentAssetVersion(job.workspaceId, assetId);
    if (!version) throw new Error('Asset has no current version to de-slop.');

    const profileRow = await getCurrentProfile(job.workspaceId, projectId);
    const profile = (profileRow?.profile ?? {}) as {
      founder_voice_samples?: string[];
      proof_assets?: unknown[];
    };
    const voiceSamples = profile.founder_voice_samples ?? [];
    const hasVoiceSamples = voiceSamples.length > 0;
    const vocPhrases = (await listMarketPhrases(job.workspaceId, marketId)).map((p) => p.phrase);
    const claims = (await listClaims(job.workspaceId, assetId)).map((c) => c.text);

    // The only legal sources for injected specifics (WO-030 acceptance).
    const sourceCorpus = [
      fullText(version.blocks as AssetBlock[]),
      JSON.stringify(profileRow?.profile ?? {}),
      vocPhrases.join('\n'),
      claims.join('\n'),
    ].join('\n\n');

    let styleCard: StyleCard | null = null;
    const scoreVoice = async (text: string): Promise<number | null> => {
      if (!hasVoiceSamples) return null;
      const result = await ai.generate({
        workspaceId: job.workspaceId,
        stage: 'scrub',
        projectId,
        jobId: job.id,
        system: [{ text: voicePrompt.body, cache: true }],
        messages: [
          {
            role: 'user',
            content: `FOUNDER VOICE SAMPLES:\n${JSON.stringify(voiceSamples)}\n\nCOPY TO SCORE:\n\n${text}`,
          },
        ],
      });
      const parsed = voiceResultSchema.parse(extractJsonObject(result.text));
      styleCard = parsed.style_card;
      return parsed.match_score;
    };

    const measure = async (blocks: AssetBlock[]): Promise<DeslopVerdict> => {
      const text = fullText(blocks);
      const metrics = measureDeslop(text, await scoreVoice(text));
      return evaluateDeslop({ metrics, spoken, hasVoiceSamples, config });
    };

    const loops: Array<{ versionId: string; verdict: DeslopVerdict }> = [];
    let verdict = await measure(version.blocks as AssetBlock[]);
    loops.push({ versionId: version.id, verdict });

    for (let loop = 0; !verdict.pass && loop < config.maxRewriteLoops; loop++) {
      // Targeted rewrite: ONLY the failing dimensions, sourced specifics only.
      const result = await ai.generate({
        workspaceId: job.workspaceId,
        stage: 'asset_drafting',
        projectId,
        jobId: job.id,
        system: [{ text: rewritePrompt.body, cache: true }],
        messages: [
          {
            role: 'user',
            content: [
              `TARGET: ${spoken ? 'SPOKEN' : 'WRITTEN'} copy, Flesch-Kincaid grade ${verdict.band[0]}-${verdict.band[1]}.`,
              `FAILING DIMENSIONS (fix ONLY these):\n${verdict.failures.map((f) => `- ${f}`).join('\n')}`,
              styleCard ? `FOUNDER STYLE CARD:\n${JSON.stringify(styleCard, null, 2)}` : '',
              `SOURCE MATERIAL — the ONLY place specifics (numbers, names) may come from:\nVOC:\n${vocPhrases.join('\n')}\nCLAIMS:\n${claims.join('\n')}\nPROFILE:\n${JSON.stringify(profileRow?.profile ?? {})}`,
              `CURRENT DRAFT:\n\n${renderBlocks(version.blocks as AssetBlock[])}`,
              'Return the rewritten blocks JSON.',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      });
      const rewritten = rewrittenBlocksSchema.parse(extractJsonObject(result.text));

      // Injector guard: no invented numbers (WO-030 acceptance).
      const invented = findInventedNumbers(fullText(rewritten.blocks as AssetBlock[]), sourceCorpus);
      if (invented.length > 0) {
        throw new Error(
          `De-slop injector violation: rewrite introduced numbers absent from the profile/VOC/claims corpus: ${invented.join(', ')}.`,
        );
      }

      await insertAssetVersion({
        workspaceId: job.workspaceId,
        assetId,
        blocks: rewritten.blocks as AssetBlock[],
        createdBy: 'system',
        meta: { deslopLoop: loop + 1, addressed: verdict.failures },
      });
      version = (await getCurrentAssetVersion(job.workspaceId, assetId))!;
      verdict = await measure(version.blocks as AssetBlock[]);
      loops.push({ versionId: version.id, verdict });
    }

    await recordAssetGate({
      workspaceId: job.workspaceId,
      assetId,
      gate: 'G5',
      pass: verdict.pass,
      report: {
        spoken,
        band: verdict.band,
        metrics: verdict.metrics,
        failures: verdict.failures,
        styleCard,
        loops: loops.map((l) => ({
          versionId: l.versionId,
          pass: l.verdict.pass,
          grade: l.verdict.metrics.grade,
          tells: l.verdict.metrics.tells.length,
          failures: l.verdict.failures,
        })),
      } as unknown as Record<string, unknown>,
    });

    if (verdict.pass) {
      await setAssetStatus(job.workspaceId, assetId, 'compliance');
    } else {
      await setAssetStatus(job.workspaceId, assetId, 'blocked');
    }
  };
}
