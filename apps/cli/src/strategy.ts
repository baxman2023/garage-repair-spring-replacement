import { readFile } from 'node:fs/promises';
import {
  checkG0,
  computeFunnelMath,
  newId,
  parseOffer,
  type FunnelMathInputs,
} from '@copyforge/core';
import type { ClientOptions } from '@copyforge/ai';
import {
  buildStrategySnapshot,
  getApprovedOffer,
  getCurrentProfile,
  getG2Status,
  listMarkets,
  listOffers,
  recordFunnelMathRun,
  recordG0,
  recordG2,
  resolveProjectById,
  selectOffer,
  type ClaimedJob,
} from '@copyforge/db';
import {
  createIntakeHandler,
  createMarketProfileHandler,
  createMarketSelectHandler,
  createOfferForgeHandler,
  INTAKE_EXTRACT_JOB,
  MARKET_PROFILE_JOB,
  MARKET_SELECT_JOB,
  OFFER_FORGE_JOB,
} from '@copyforge/pipeline';

/**
 * Headless strategy phase (WO-016): intake input → offer forge (G0) →
 * funnel math (G1) → market selection → market profiles, with G2 available
 * under --auto-approve. Pipeline handlers run INLINE (no worker process), so
 * the whole phase is a single CI-runnable invocation.
 */

export interface StrategyOptions {
  projectId: string;
  autoApprove: boolean;
  /** Optional dump file (txt/md) ingested through Sales Detective first. */
  dumpFile?: string;
  /** Funnel-math inputs; price defaults from the approved offer. */
  math?: Partial<FunnelMathInputs>;
}

export interface StrategyDeps {
  clientOptions?: ClientOptions;
}

export interface StrategySummary {
  ok: boolean;
  projectId: string;
  steps: Record<string, { status: 'done' | 'skipped' | 'blocked' | 'pending'; detail?: string }>;
  gates: { g0: boolean; g1: boolean; g2: boolean };
  fixes?: unknown[];
  markets?: Array<{ rank: number; label: string; score: number | null; diagnosed: boolean }>;
}

function job(workspaceId: string, type: string, payload: Record<string, unknown>): ClaimedJob {
  return { id: newId(), workspaceId, type, payload, attempts: 1, jobRunId: newId() };
}

export async function runStrategyPhase(
  opts: StrategyOptions,
  deps: StrategyDeps = {},
): Promise<StrategySummary> {
  const steps: StrategySummary['steps'] = {};
  const gates = { g0: false, g1: false, g2: false };
  const summary = (ok: boolean, extra: Partial<StrategySummary> = {}): StrategySummary => ({
    ok,
    projectId: opts.projectId,
    steps,
    gates,
    ...extra,
  });

  // Resolve project → workspace (operator tooling: the id names the tenant).
  const project = await resolveProjectById(opts.projectId);
  if (!project) {
    steps.project = { status: 'blocked', detail: 'Project not found.' };
    return summary(false);
  }
  const workspaceId = project.workspaceId;

  // 1. Intake (WO-009 input): optional dump file, else require an existing profile.
  if (opts.dumpFile) {
    const text = await readFile(opts.dumpFile, 'utf8');
    await createIntakeHandler({ clientOptions: deps.clientOptions })(
      job(workspaceId, INTAKE_EXTRACT_JOB, { projectId: opts.projectId, text }),
    );
    steps.intake = { status: 'done', detail: `Ingested ${opts.dumpFile}` };
  }
  const profile = await getCurrentProfile(workspaceId, opts.projectId);
  if (!profile) {
    steps.intake = {
      status: 'blocked',
      detail: 'No product profile. Run Sales Detective intake or pass --dump-file.',
    };
    return summary(false);
  }
  steps.intake ??= { status: 'skipped', detail: `Profile v${profile.version} already present.` };

  // 2. Offer Forge + G0.
  let approved = await getApprovedOffer(workspaceId, opts.projectId);
  if (approved) {
    steps.offer = { status: 'skipped', detail: 'Approved offer already present.' };
    gates.g0 = true;
  } else {
    const existing = await listOffers(workspaceId, opts.projectId);
    if (existing.length === 0) {
      await createOfferForgeHandler(deps.clientOptions ?? {})(
        job(workspaceId, OFFER_FORGE_JOB, { projectId: opts.projectId }),
      );
    }
    if (!opts.autoApprove) {
      steps.offer = { status: 'pending', detail: 'Variants forged — approve one in the UI (G0).' };
      return summary(false);
    }
    // Auto-approve: first variant passing the G0 checklist, highest version first.
    const variants = await listOffers(workspaceId, opts.projectId);
    const winner = variants.find((v) => checkG0(parseOffer(v.offer)).pass);
    if (!winner) {
      steps.offer = { status: 'blocked', detail: 'No forged variant passes the G0 checklist.' };
      return summary(false);
    }
    await selectOffer({ workspaceId, projectId: opts.projectId, offerId: winner.id });
    const report = checkG0(parseOffer(winner.offer));
    await recordG0({
      workspaceId,
      projectId: opts.projectId,
      offerId: winner.id,
      pass: report.pass,
      report: report as unknown as Record<string, unknown>,
    });
    approved = await getApprovedOffer(workspaceId, opts.projectId);
    steps.offer = { status: 'done', detail: `Auto-approved "${parseOffer(winner.offer).name}".` };
    gates.g0 = true;
  }

  // 3. Funnel math (G1) — hard stop on fail.
  const offer = parseOffer(approved!.offer);
  const mathInputs: FunnelMathInputs = {
    price: opts.math?.price ?? (offer.price.amount || 100),
    margin: opts.math?.margin ?? 0.8,
    refundRate: opts.math?.refundRate ?? 0.05,
    channels: opts.math?.channels ?? [{ name: 'meta', cpc: 2 }],
  };
  const mathReport = computeFunnelMath(mathInputs);
  await recordFunnelMathRun({
    workspaceId,
    projectId: opts.projectId,
    inputs: mathInputs as unknown as Record<string, unknown>,
    outputs: {
      allowableCpa: mathReport.allowableCpa,
      breakevenRoas: mathReport.breakevenRoas,
      channels: mathReport.channels,
    },
    pass: mathReport.pass,
    report: mathReport as unknown as Record<string, unknown>,
  });
  if (!mathReport.pass) {
    steps.funnelMath = { status: 'blocked', detail: 'G1 HARD STOP — funnel uneconomic.' };
    return summary(false, { fixes: mathReport.fixes });
  }
  steps.funnelMath = {
    status: 'done',
    detail: `Allowable CPA $${mathReport.allowableCpa}; best channel ${mathReport.bestChannel}.`,
  };
  gates.g1 = true;

  // 4. Market selection (skip when 5 markets already exist).
  let markets = await listMarkets(workspaceId, opts.projectId);
  if (markets.length < 5) {
    await createMarketSelectHandler(deps.clientOptions ?? {})(
      job(workspaceId, MARKET_SELECT_JOB, { projectId: opts.projectId }),
    );
    markets = await listMarkets(workspaceId, opts.projectId);
    steps.marketSelect = { status: 'done', detail: `${markets.length} markets ranked.` };
  } else {
    steps.marketSelect = { status: 'skipped', detail: 'Markets already selected.' };
  }

  // 5. Market profiles (Schwartz diagnosis) for any undiagnosed market.
  const profileHandler = createMarketProfileHandler(deps.clientOptions ?? {});
  let diagnosedCount = 0;
  for (const market of markets) {
    const status = await getG2StatusSafeDiagnosis(workspaceId, opts.projectId, market.id);
    if (status) {
      diagnosedCount++;
      continue;
    }
    await profileHandler(
      job(workspaceId, MARKET_PROFILE_JOB, { projectId: opts.projectId, marketId: market.id }),
    );
    diagnosedCount++;
  }
  steps.marketProfiles = { status: 'done', detail: `${diagnosedCount}/5 markets diagnosed.` };

  // 6. G2 — only under --auto-approve (it is a human checkpoint by design).
  if (opts.autoApprove) {
    const snapshot = await buildStrategySnapshot(workspaceId, opts.projectId);
    await recordG2({ workspaceId, projectId: opts.projectId, snapshot });
    steps.g2 = { status: 'done', detail: `Snapshot ${snapshot.hash.slice(0, 12)}…` };
    gates.g2 = true;
  } else {
    const status = await getG2Status(workspaceId, opts.projectId);
    gates.g2 = status.approved;
    steps.g2 = status.approved
      ? { status: 'done', detail: 'Already approved.' }
      : { status: 'pending', detail: 'Approve the strategy review in the UI (G2).' };
  }

  const finalMarkets = await listMarkets(workspaceId, opts.projectId);
  return summary(gates.g1 && gates.g0 && (opts.autoApprove ? gates.g2 : true), {
    markets: finalMarkets.map((m) => ({
      rank: m.rank,
      label: m.label,
      score: m.scoreTotal ? Number(m.scoreTotal) : null,
      diagnosed: m.awarenessStage !== null,
    })),
  });
}

/** True when the market already has a full diagnosis. */
async function getG2StatusSafeDiagnosis(
  workspaceId: string,
  projectId: string,
  marketId: string,
): Promise<boolean> {
  const markets = await listMarkets(workspaceId, projectId);
  const market = markets.find((m) => m.id === marketId);
  return Boolean(market?.awarenessStage);
}
