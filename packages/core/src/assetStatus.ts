/**
 * Asset status machine (WO-021 / spec §2.1). One module owns every legal
 * transition:
 *
 *   draft → council → (revising ⇄ council) → focus_group → deslop
 *     → compliance → packaging → approved → live → retired
 *
 * Any gate stage may fail into `blocked`. Owners may OVERRIDE out of
 * `blocked` back into the flow — always audited by the caller.
 */

export const ASSET_STATUSES = [
  'draft',
  'council',
  'revising',
  'focus_group',
  'deslop',
  'compliance',
  'packaging',
  'approved',
  'live',
  'retired',
  'blocked',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

const TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  draft: ['council', 'blocked'],
  council: ['revising', 'focus_group', 'blocked'],
  revising: ['council', 'blocked'],
  focus_group: ['deslop', 'revising', 'blocked'],
  deslop: ['compliance', 'blocked'],
  compliance: ['packaging', 'blocked'],
  packaging: ['approved', 'blocked'],
  approved: ['live'],
  live: ['retired'],
  retired: [],
  blocked: [], // only override leaves blocked
};

/** Stages an owner override may resume into from `blocked`. */
const OVERRIDE_TARGETS: AssetStatus[] = [
  'draft',
  'council',
  'revising',
  'focus_group',
  'deslop',
  'compliance',
  'packaging',
  'approved',
];

export function canTransition(
  from: AssetStatus,
  to: AssetStatus,
  opts: { override?: boolean } = {},
): boolean {
  if (from === to) return false;
  if (TRANSITIONS[from]?.includes(to)) return true;
  if (opts.override && from === 'blocked' && OVERRIDE_TARGETS.includes(to)) return true;
  return false;
}

export function assertTransition(
  from: AssetStatus,
  to: AssetStatus,
  opts: { override?: boolean } = {},
): void {
  if (!canTransition(from, to, opts)) {
    throw new Error(
      `Illegal asset status transition: ${from} → ${to}${opts.override ? ' (even with override)' : ''}.`,
    );
  }
}
