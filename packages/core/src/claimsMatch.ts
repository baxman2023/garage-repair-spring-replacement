/**
 * Claims inventory helpers (WO-031, pure). Every claim is proven or flagged
 * (§5 G6). When an asset regenerates, resolved claims survive by TEXT
 * SIMILARITY — a paraphrased claim keeps its attached proof; a genuinely new
 * claim arrives flagged.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in',
  'on', 'for', 'by', 'with', 'and', 'or', 'that', 'this', 'it', 'its', 'your',
  'you', 'we', 'our', 'their',
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

/** Token Jaccard similarity in [0, 1] over stopword-free tokens. */
export function claimSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / (ta.size + tb.size - intersection);
}

export const CLAIM_REMATCH_THRESHOLD = 0.55;

export interface ClaimLike {
  text: string;
  proofRef?: string | null;
  status?: 'proven' | 'flagged';
}

export interface RematchedClaim {
  text: string;
  proofRef: string | null;
  status: 'proven' | 'flagged';
  /** Text of the prior claim whose resolution was carried, if any. */
  rematchedFrom: string | null;
}

/**
 * Carry resolutions across regeneration: an incoming claim similar (≥
 * threshold) to a resolved existing claim inherits its proofRef/status.
 * Incoming claims that already carry a proofRef keep it.
 */
export function rematchClaims(
  incoming: ClaimLike[],
  existing: ClaimLike[],
  threshold: number = CLAIM_REMATCH_THRESHOLD,
): RematchedClaim[] {
  return incoming.map((claim) => {
    let best: { claim: ClaimLike; score: number } | null = null;
    for (const prior of existing) {
      const score = claimSimilarity(claim.text, prior.text);
      if (score >= threshold && (!best || score > best.score)) {
        best = { claim: prior, score };
      }
    }
    const ownProof = claim.proofRef || null;
    if (ownProof) {
      return { text: claim.text, proofRef: ownProof, status: claim.status ?? 'proven', rematchedFrom: null };
    }
    if (best && (best.claim.status === 'proven' || best.claim.proofRef)) {
      return {
        text: claim.text,
        proofRef: best.claim.proofRef ?? null,
        status: best.claim.status ?? 'proven',
        rematchedFrom: best.claim.text,
      };
    }
    return { text: claim.text, proofRef: null, status: 'flagged', rematchedFrom: null };
  });
}

// --- Flag report + strict-mode precondition (feeds G6 in WO-032) ---------------

export interface ClaimsFlagReport {
  total: number;
  proven: number;
  flagged: number;
  flaggedClaims: string[];
}

export function buildClaimsFlagReport(
  claims: Array<{ text: string; status: 'proven' | 'flagged' }>,
): ClaimsFlagReport {
  const flagged = claims.filter((c) => c.status === 'flagged');
  return {
    total: claims.length,
    proven: claims.length - flagged.length,
    flagged: flagged.length,
    flaggedClaims: flagged.map((c) => c.text),
  };
}

/**
 * §5 G6 precondition: in strict compliance modes (health/finance) the gate
 * fails closed while ANY unresolved flag exists. Throws with the flag list.
 */
export function assertClaimsResolvedForStrictMode(
  report: ClaimsFlagReport,
  complianceMode: 'none' | 'health' | 'finance',
): void {
  if (complianceMode === 'none') return;
  if (report.flagged > 0) {
    throw new Error(
      `G6 blocked (${complianceMode} mode): ${report.flagged} unresolved flagged claim(s): ${report.flaggedClaims.join(' | ')}`,
    );
  }
}
