import { z } from 'zod';
import type { AssetBlock } from './blocks.js';
import type { MarketProfile } from './contracts/marketProfile.js';

/**
 * Synthetic Focus Group — gate G4 (WO-029, pure parts). Personas are sampled
 * deterministically from the market profile (skepticism and awareness varied
 * within the diagnosed band), consumption results are contract-parsed, and the
 * aggregate applies config-driven thresholds (§5): the cohort must reach the
 * CTA at ≥ minCtaReachRatio and no claim may spike disbelief in ≥
 * disbeliefSpikeRatio of the cohort. Annotations anchor to REAL block ids.
 */

export interface FocusGroupConfig {
  personaCount: number;
  /** Personas simulated per model call (spec: batched). */
  batchSize: number;
  /** G4: fraction of the cohort that must reach the CTA. */
  minCtaReachRatio: number;
  /** G4: a claim disbelieved by ≥ this fraction of the cohort fails the gate. */
  disbeliefSpikeRatio: number;
}

export const DEFAULT_FOCUS_GROUP_CONFIG: FocusGroupConfig = {
  personaCount: 20,
  batchSize: 5,
  minCtaReachRatio: 0.7,
  disbeliefSpikeRatio: 0.5,
};

const AWARENESS_ORDER = ['unaware', 'problem', 'solution', 'product', 'most'] as const;

export interface FocusPersona {
  id: string;
  identity: string;
  ageRange: string;
  situation: string;
  /** 1 (trusting) … 5 (hostile skeptic). */
  skepticism: number;
  awareness: (typeof AWARENESS_ORDER)[number];
  /** The objection this persona leads with. */
  primaryObjection: string;
}

/**
 * Deterministic persona cohort: skepticism cycles 1–5, awareness stays within
 * the diagnosed band (the stage itself plus its immediate neighbors), and each
 * persona leads with one of the market's real objections. No RNG — CI-stable.
 */
export function samplePersonas(profile: MarketProfile, count: number): FocusPersona[] {
  const stageIndex = AWARENESS_ORDER.indexOf(profile.awareness_stage);
  const band = [stageIndex, Math.max(0, stageIndex - 1), Math.min(AWARENESS_ORDER.length - 1, stageIndex + 1)];
  const objections = profile.objections.length > 0 ? profile.objections : ['is this real?'];
  return Array.from({ length: count }, (_v, i) => ({
    id: `persona-${i + 1}`,
    identity: profile.avatar.identity,
    ageRange: profile.avatar.age_range,
    situation: profile.avatar.situation,
    skepticism: (i % 5) + 1,
    awareness: AWARENESS_ORDER[band[i % band.length]!]!,
    primaryObjection: objections[i % objections.length]!,
  }));
}

export const personaResultSchema = z.object({
  persona_id: z.string().trim().min(1),
  reached_cta: z.boolean(),
  /** Block id where attention dropped (null = read/watched to the end). */
  attention_drop_block: z.string().trim().min(1).nullable(),
  /** Claims (verbatim or near-verbatim) that spiked disbelief. */
  disbelief_claims: z.array(z.string().trim().min(1)).default([]),
  bounce_reason: z.string().trim().default(''),
  /** "Would you tell your spouse to buy this?" — the felt one-liner. */
  spouse_test_quote: z.string().trim().min(1),
});
export type PersonaResult = z.infer<typeof personaResultSchema>;

export const focusBatchSchema = z.object({ results: z.array(personaResultSchema).min(1) });

export interface FocusAnnotation {
  blockId: string;
  kind: 'attention_drop' | 'disbelief';
  count: number;
  note: string;
}

export interface FocusGroupReport {
  pass: boolean;
  failures: string[];
  cohortSize: number;
  ctaReachRatio: number;
  /** Disbelief spikes per claim, worst first. */
  spikes: Array<{ claim: string; count: number; ratio: number }>;
  bounceReasons: string[];
  spouseQuotes: string[];
  annotations: FocusAnnotation[];
  config: FocusGroupConfig;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Aggregate the cohort (pure). Throws when an annotation references a block id
 * that does not exist in the draft — anchors must be real (acceptance).
 */
export function aggregateFocusGroup(params: {
  results: PersonaResult[];
  blocks: AssetBlock[];
  /** The asset's claims inventory; disbelief entries map onto these. */
  claims: string[];
  config?: FocusGroupConfig;
}): FocusGroupReport {
  const config = params.config ?? DEFAULT_FOCUS_GROUP_CONFIG;
  const blockIds = new Set(params.blocks.map((b) => b.id));
  const cohortSize = params.results.length;
  if (cohortSize === 0) throw new Error('Focus group aggregation needs at least one persona result.');

  // Attention drops — anchored, counted per block.
  const dropCounts = new Map<string, number>();
  for (const r of params.results) {
    if (r.attention_drop_block === null) continue;
    if (!blockIds.has(r.attention_drop_block)) {
      throw new Error(
        `Focus group contract violation: persona "${r.persona_id}" anchored an attention drop to unknown block "${r.attention_drop_block}".`,
      );
    }
    dropCounts.set(r.attention_drop_block, (dropCounts.get(r.attention_drop_block) ?? 0) + 1);
  }

  // Disbelief — matched to the claims inventory (normalized containment).
  const normClaims = params.claims.map((c) => ({ claim: c, norm: normalize(c) }));
  const spikeCounts = new Map<string, number>();
  const claimBlocks = new Map<string, string>(); // claim → first block containing it
  for (const r of params.results) {
    const seenThisPersona = new Set<string>();
    for (const raw of r.disbelief_claims) {
      const norm = normalize(raw);
      const hit = normClaims.find((c) => c.norm.includes(norm) || norm.includes(c.norm));
      const key = hit ? hit.claim : raw;
      if (seenThisPersona.has(key)) continue; // one vote per persona per claim
      seenThisPersona.add(key);
      spikeCounts.set(key, (spikeCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [claim] of spikeCounts) {
    const norm = normalize(claim);
    const carrier = params.blocks.find((b) => normalize(b.text).includes(norm));
    if (carrier) claimBlocks.set(claim, carrier.id);
  }

  const reached = params.results.filter((r) => r.reached_cta).length;
  const ctaReachRatio = reached / cohortSize;
  const spikes = [...spikeCounts.entries()]
    .map(([claim, count]) => ({ claim, count, ratio: count / cohortSize }))
    .sort((a, b) => b.count - a.count);

  const failures: string[] = [];
  if (ctaReachRatio < config.minCtaReachRatio) {
    failures.push(
      `Only ${(ctaReachRatio * 100).toFixed(0)}% of the cohort reached the CTA (need ≥ ${(config.minCtaReachRatio * 100).toFixed(0)}%).`,
    );
  }
  for (const s of spikes) {
    if (s.ratio >= config.disbeliefSpikeRatio) {
      failures.push(
        `Claim "${s.claim}" spiked disbelief in ${(s.ratio * 100).toFixed(0)}% of the cohort (limit < ${(config.disbeliefSpikeRatio * 100).toFixed(0)}%).`,
      );
    }
  }

  const annotations: FocusAnnotation[] = [
    ...[...dropCounts.entries()].map(([blockId, count]) => ({
      blockId,
      kind: 'attention_drop' as const,
      count,
      note: `${count}/${cohortSize} personas dropped attention here.`,
    })),
    ...spikes
      .filter((s) => claimBlocks.has(s.claim))
      .map((s) => ({
        blockId: claimBlocks.get(s.claim)!,
        kind: 'disbelief' as const,
        count: s.count,
        note: `Disbelief (${s.count}/${cohortSize}): "${s.claim}"`,
      })),
  ].sort((a, b) => b.count - a.count);

  return {
    pass: failures.length === 0,
    failures,
    cohortSize,
    ctaReachRatio,
    spikes,
    bounceReasons: params.results.filter((r) => !r.reached_cta && r.bounce_reason).map((r) => r.bounce_reason),
    spouseQuotes: params.results.map((r) => r.spouse_test_quote),
    annotations,
    config,
  };
}

/** The revision brief for the one-click "fix annotations" pass. */
export function composeFocusFixBrief(report: FocusGroupReport, blocks: AssetBlock[]): string {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const lines: string[] = ['FOCUS GROUP REVISION BRIEF — fix ONLY what the cohort flagged:'];
  for (const f of report.failures) lines.push(`- GATE FAILURE: ${f}`);
  for (const a of report.annotations) {
    const block = byId.get(a.blockId);
    lines.push(
      `- [block ${a.blockId} · ${block?.role ?? '?'}] ${a.kind === 'attention_drop' ? 'ATTENTION DROP' : 'DISBELIEF'}: ${a.note}`,
    );
  }
  if (report.bounceReasons.length > 0) {
    lines.push(`- Bounce reasons: ${[...new Set(report.bounceReasons)].slice(0, 8).join(' | ')}`);
  }
  return lines.join('\n');
}

/** Markdown export of the report (acceptance: report exportable). */
export function renderFocusReportMarkdown(report: FocusGroupReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  return [
    `# Synthetic Focus Group — G4 ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    `- Cohort: ${report.cohortSize} personas`,
    `- Reached CTA: ${pct(report.ctaReachRatio)} (threshold ≥ ${pct(report.config.minCtaReachRatio)})`,
    ...report.failures.map((f) => `- ❌ ${f}`),
    '',
    '## Disbelief spikes',
    ...(report.spikes.length > 0
      ? report.spikes.map((s) => `- ${pct(s.ratio)} — "${s.claim}"`)
      : ['- none']),
    '',
    '## Annotations (anchored to block ids)',
    ...(report.annotations.length > 0
      ? report.annotations.map((a) => `- \`${a.blockId}\` [${a.kind}] ${a.note}`)
      : ['- none']),
    '',
    '## Spouse test',
    ...report.spouseQuotes.map((q) => `> ${q}`),
    '',
    '## Bounce reasons',
    ...(report.bounceReasons.length > 0 ? report.bounceReasons.map((r) => `- ${r}`) : ['- none']),
    '',
  ].join('\n');
}
