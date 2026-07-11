import {
  emailSequenceResultSchema,
  extractJsonObject,
  JOB_TYPES,
  parseExtractedClaims,
  sequenceGraph,
  SEQUENCE_KINDS,
  SEQUENCE_SPECS,
  validateEmailSequence,
  type AssetBlock,
  type SequenceKind,
} from '@copyforge/core';
import type { createClient } from '@copyforge/ai';
import {
  createAsset,
  enqueueJob,
  getPrompt,
  insertAssetVersion,
  insertClaims,
} from '@copyforge/db';
import type { GenerationContext } from './context.js';

/**
 * Email-sequence generator (WO-026): the owned-audience engine. Four sequence
 * kinds per market — welcome (5–7), launch seed→open→close (9), cart abandon
 * (3), daily infotainment templates in founder voice (10). One asset per
 * sequence; blocks are subject/preview/body triplets sectioned per email; the
 * version meta persists the sequence graph with send-offset metadata. Written
 * copy: no spoken processing, no timestamps.
 */

/** Extra, kind-specific instructions appended to the dynamic message. */
const KIND_BRIEFS: Record<SequenceKind, string> = {
  welcome:
    'KIND welcome: five to seven emails. Indoctrinate: origin story, the enemy, the mechanism, proof, first small win. Offsets in hours from signup (first at zero).',
  launch:
    'KIND launch: EXACTLY nine emails in three phases, tagged "phase": three "seed" (story/anticipation), three "open" (cart open, offer, proof), three "close" (objections, deadline, final call using {{deadline_date}}). Offsets in hours from launch start, strictly increasing.',
  cart_abandon:
    'KIND cart_abandon: EXACTLY three emails. Offsets in hours from abandonment (e.g. one, twenty-four, forty-eight). 1: friction remover ("something go wrong?"). 2: objection killer with proof. 3: honest deadline.',
  daily_infotainment:
    'KIND daily_infotainment: EXACTLY ten template emails IN THE FOUNDER VOICE (match the founder voice samples provided). Infotainment: a story or observation from the founder’s world that lands on one persuasive point. Offsets: twenty-four-hour steps (day one = twenty-four).',
};

export async function generateEmailSequences(params: {
  ai: ReturnType<typeof createClient>;
  workspaceId: string;
  projectId: string;
  jobId?: string;
  context: GenerationContext;
  /** Restrict to specific kinds (fan-out orchestration); default all four. */
  sequences?: SequenceKind[];
}): Promise<{ assetIds: string[] }> {
  const { context } = params;
  const kinds = params.sequences ?? [...SEQUENCE_KINDS];
  const unknownKind = kinds.find((k) => !(SEQUENCE_KINDS as readonly string[]).includes(k));
  if (unknownKind) throw new Error(`Unknown email sequence kind "${unknownKind}".`);

  const prompt = await getPrompt('generate.email_sequence');
  if (!prompt) throw new Error('No active prompt "generate.email_sequence" — run the seed.');
  const claimsPrompt = await getPrompt('claims.extract');
  if (!claimsPrompt) throw new Error('No active prompt "claims.extract" — run the seed.');

  const assetIds: string[] = [];
  for (const kind of kinds) {
    const spec = SEQUENCE_SPECS[kind];
    const result = await params.ai.generate({
      workspaceId: params.workspaceId,
      stage: 'asset_drafting',
      projectId: params.projectId,
      jobId: params.jobId,
      system: [
        { text: context.genomeBlock, cache: true },
        { text: `${context.marketBlock}\n\n${context.vocBlock}`, cache: true },
        { text: prompt.body, cache: true },
      ],
      messages: [
        {
          role: 'user',
          content: [
            KIND_BRIEFS[kind],
            `PRODUCT PROFILE:\n${JSON.stringify(context.profile, null, 2)}`,
            `FOUNDER VOICE SAMPLES:\n${JSON.stringify(context.profile.founder_voice_samples)}`,
            `APPROVED OFFER:\n${JSON.stringify(context.offer, null, 2)}`,
            `Write the ${spec.label} sequence as the JSON contract specifies.`,
          ].join('\n\n'),
        },
      ],
    });

    const { emails } = emailSequenceResultSchema.parse(extractJsonObject(result.text));
    validateEmailSequence(kind, emails);

    const blocks: AssetBlock[] = emails.flatMap((email) => {
      const meta = {
        section: email.id,
        sendOffsetHours: email.send_offset_hours,
        ...(email.phase ? { phase: email.phase } : {}),
      };
      return [
        { id: `${email.id}-subject`, role: 'subject', text: email.subject, meta },
        { id: `${email.id}-preview`, role: 'preview', text: email.preview, meta },
        { id: `${email.id}-body`, role: 'body', text: email.body, meta },
      ];
    });

    const assetId = await createAsset({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      marketId: context.marketId,
      type: 'email_sequence',
      promptVersionId: prompt.id,
    });
    const version = await insertAssetVersion({
      workspaceId: params.workspaceId,
      assetId,
      blocks,
      createdBy: 'system',
      promptVersionId: prompt.id,
      meta: { sequence: sequenceGraph(kind, emails) },
    });
    assetIds.push(assetId);

    const fullText = emails.map((e) => `${e.subject}\n${e.preview}\n${e.body}`).join('\n\n');
    const claimsResult = await params.ai.generate({
      workspaceId: params.workspaceId,
      stage: 'claims_extraction',
      projectId: params.projectId,
      jobId: params.jobId,
      system: [{ text: claimsPrompt.body, cache: true }],
      messages: [
        {
          role: 'user',
          content: `KNOWN PROOF ASSETS:\n${JSON.stringify(context.profile.proof_assets)}\n\nCOPY:\n\n${fullText}`,
        },
      ],
    });
    const { claims } = parseExtractedClaims(extractJsonObject(claimsResult.text));
    await insertClaims({
      workspaceId: params.workspaceId,
      assetId,
      assetVersionId: version.id,
      claims: claims.map((c) => ({ text: c.text, proofRef: c.proof_ref || undefined })),
    });

    await enqueueJob({
      workspaceId: params.workspaceId,
      type: JOB_TYPES.assetCouncil,
      payload: { projectId: params.projectId, assetId, marketId: context.marketId },
    });
  }

  return { assetIds };
}
