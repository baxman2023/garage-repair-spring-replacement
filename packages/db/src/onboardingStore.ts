import { tenantDb } from './guard.js';
import { getCurrentProfile } from './profiles.js';
import { getApprovedOffer } from './offers.js';
import { latestFunnelMathRun } from './funnelMath.js';
import { listMarkets } from './markets.js';
import { getG2Status } from './strategyGate.js';
import { latestBuild } from './builds.js';
import { exports as exportsTable, pageBuildPackages } from './schema/index.js';

/**
 * "First Funnel Today" onboarding (WO-054). The checklist derives ONLY from
 * real pipeline state — it is the same ladder the gates enforce (profile →
 * offer/G0 → math/G1 → markets/G2 → build → delivery), so a user who follows
 * the pointers necessarily reaches an approved strategy.
 */

export type OnboardingStepKey = 'profile' | 'offer' | 'math' | 'markets' | 'build' | 'delivery';

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  done: boolean;
  href: string;
  /** The next action, phrased for the empty state. */
  hint: string;
  docs: string;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  /** First not-done step — where the UI sends the user next. */
  next: OnboardingStep | null;
  /** True once G2 is approved: the WO-054 acceptance milestone. */
  strategyApproved: boolean;
}

export async function onboardingProgress(
  workspaceId: string,
  projectId: string,
): Promise<OnboardingProgress> {
  const db = tenantDb(workspaceId);
  const base = `/projects/${projectId}`;

  const profileRow = await getCurrentProfile(workspaceId, projectId);
  const profile = profileRow ? (profileRow.profile as { name?: string }) : null;
  const profileDone = Boolean(profile?.name && String(profile.name).trim().length > 0);

  const approvedOffer = await getApprovedOffer(workspaceId, projectId);
  const offerDone = approvedOffer !== null;

  const math = await latestFunnelMathRun(workspaceId, projectId);
  const mathDone = Boolean(math?.pass);

  const markets = await listMarkets(workspaceId, projectId);
  const g2 = await getG2Status(workspaceId, projectId);
  const marketsDone = g2.approved;

  const build = await latestBuild(workspaceId, projectId);
  const buildDone = build?.status === 'done';

  const packages = await db.findMany(pageBuildPackages, undefined);
  const exportRows = await db.findMany(exportsTable, undefined);
  const deliveryDone = packages.length > 0 || exportRows.length > 0;

  const steps: OnboardingStep[] = [
    {
      key: 'profile',
      label: 'Product profile',
      done: profileDone,
      href: `${base}`,
      hint: 'Tell the Sales Detective about your product — paste anything you have, it interrogates for the rest.',
      docs: '/docs/sales-detective',
    },
    {
      key: 'offer',
      label: 'Offer (G0)',
      done: offerDone,
      href: `${base}/offer`,
      hint: 'Forge offer variants and approve one — nothing generates until G0 passes.',
      docs: '/docs/getting-started',
    },
    {
      key: 'math',
      label: 'Funnel math (G1)',
      done: mathDone,
      href: `${base}/math`,
      hint: 'Run the funnel math with your price and margins — the gate blocks unprofitable funnels.',
      docs: '/docs/getting-started',
    },
    {
      key: 'markets',
      label: `Markets & strategy (G2)${markets.length ? ` — ${markets.length} diagnosed` : ''}`,
      done: marketsDone,
      href: `${base}/markets`,
      hint: 'Diagnose the five starving-crowd markets, then approve the strategy snapshot (G2).',
      docs: '/docs/gates',
    },
    {
      key: 'build',
      label: 'Build the funnel',
      done: buildDone,
      href: `${base}/build`,
      hint: 'Fan out the full 5-market build — every asset earns its way through the gate ladder.',
      docs: '/docs/gates',
    },
    {
      key: 'delivery',
      label: 'Delivery & export',
      done: deliveryDone,
      href: `${base}/delivery`,
      hint: 'Package approved assets and export the build kits — your copy, your files.',
      docs: '/docs/delivery',
    },
  ];

  return {
    steps,
    next: steps.find((s) => !s.done) ?? null,
    strategyApproved: marketsDone,
  };
}
