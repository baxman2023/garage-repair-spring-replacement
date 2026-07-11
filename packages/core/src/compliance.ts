import type { AssetBlock } from './blocks.js';

/**
 * Compliance pre-flight — gate G6 (WO-032, pure parts). Config rule packs:
 * FTC (testimonials/endorsements, earnings), health mode (disease-claims
 * list), finance mode (earnings disclaimers required), and Meta/Google
 * ad-policy lint (personal attributes, before/after, sensational). Findings
 * anchor to block ids with the matched excerpt (the "line ref"). ERROR
 * findings and strict-mode claim failures are never acknowledgeable;
 * WARNING findings may be acknowledged with an audit trail.
 */

export type CompliancePack = 'ftc' | 'health' | 'finance' | 'ad_policy';
export type ComplianceSeverity = 'error' | 'warning';

export interface ComplianceRule {
  id: string;
  pack: CompliancePack;
  severity: ComplianceSeverity;
  description: string;
  pattern: RegExp;
  /** The finding only fires if this pattern is ABSENT from the full asset text. */
  unlessPresent?: RegExp;
}

const DISEASE_LIST =
  '(?:diabetes|cancer|arthritis|alzheimer(?:’|\')?s?|dementia|depression|anxiety|heart\\s+disease|high\\s+blood\\s+pressure|hypertension|obesity|covid|asthma|adhd|autism|insomnia|eczema|psoriasis)';

const EARNINGS_PATTERN =
  '(?:make|earn|made|earned|profit|pull(?:ed)?\\s+in)\\s+(?:me\\s+|up\\s+to\\s+)?(?:\\$|usd\\s*)?[\\d,]+(?:\\s*(?:dollars|per|a|each|\\/)\\s*(?:day|week|month|year|sale|client|hour)?)?';

/** The rule packs (config, not code — extend the list, not the runner). */
export const COMPLIANCE_RULES: readonly ComplianceRule[] = [
  // --- FTC ---------------------------------------------------------------------
  {
    id: 'ftc.earnings_claim_disclaimer',
    pack: 'ftc',
    severity: 'warning',
    description:
      'Earnings claim without a typicality disclaimer (FTC endorsement guides) — add "results not typical"/"results may vary" or remove the figure.',
    pattern: new RegExp(EARNINGS_PATTERN, 'i'),
    unlessPresent: /results\s+(?:are\s+)?not\s+typical|results\s+(?:may|will)\s+vary|no\s+guarantee\s+of\s+(?:income|earnings|results)/i,
  },
  {
    id: 'ftc.testimonial_disclosure',
    pack: 'ftc',
    severity: 'warning',
    description:
      'Testimonial/endorsement framing without a disclosure that results are individual (FTC §255).',
    pattern: /["“][^"”]{20,}["”]\s*[—–-]\s*[A-Z][a-z]+|(?:testimonial|verified\s+customer|real\s+customer\s+story)/i,
    unlessPresent: /individual\s+results|results\s+(?:are\s+)?not\s+typical|results\s+(?:may|will)\s+vary/i,
  },
  {
    id: 'ftc.guaranteed_outcome',
    pack: 'ftc',
    severity: 'error',
    description: 'Guaranteed outcome/income language — the FTC treats outcome guarantees as deceptive.',
    pattern: /guaranteed?\s+(?:income|earnings|profits?|results?|weight\s+loss|cure)/i,
  },
  // --- Health mode ----------------------------------------------------------------
  {
    id: 'health.disease_claim',
    pack: 'health',
    severity: 'error',
    description:
      'Disease treatment/cure/prevention claim — prohibited without drug approval (health mode disease list).',
    pattern: new RegExp(`(?:cures?|treats?|heals?|prevents?|reverses?|fixe?s|eliminates?)\\s+(?:your\\s+)?${DISEASE_LIST}`, 'i'),
  },
  {
    id: 'health.diagnosis_language',
    pack: 'health',
    severity: 'warning',
    description: 'Implied diagnosis ("you have X") — rewrite as educational language.',
    pattern: new RegExp(`you\\s+(?:have|suffer\\s+from|are\\s+suffering\\s+from)\\s+${DISEASE_LIST}`, 'i'),
  },
  // --- Finance mode ------------------------------------------------------------------
  {
    id: 'finance.earnings_disclaimer_required',
    pack: 'finance',
    severity: 'error',
    description:
      'Finance mode: earnings/return claims REQUIRE an explicit disclaimer ("results may vary", "past performance…").',
    pattern: new RegExp(`${EARNINGS_PATTERN}|\\b(?:roi|returns?)\\s+of\\s+[\\d.]+\\s*%`, 'i'),
    unlessPresent: /results\s+(?:may|will)\s+vary|past\s+performance|no\s+guarantee\s+of\s+(?:income|earnings|returns)/i,
  },
  {
    id: 'finance.risk_free',
    pack: 'finance',
    severity: 'error',
    description: 'Finance mode: "risk-free" investment/return language is prohibited.',
    pattern: /risk[-\s]?free\s+(?:returns?|investment|profits?|trading)/i,
  },
  // --- Meta/Google ad-policy lint ------------------------------------------------------
  {
    id: 'ad_policy.personal_attributes',
    pack: 'ad_policy',
    severity: 'warning',
    description:
      'Direct personal-attribute callout ("your debt", "do you suffer from…") — Meta/Google prohibit implying knowledge of personal traits.',
    pattern: /\b(?:your\s+(?:debt|weight|depression|anxiety|diabetes|credit\s+score|bald(?:ing|ness)|wrinkles|addiction)|do\s+you\s+suffer\s+from|are\s+you\s+(?:overweight|depressed|broke|in\s+debt))\b/i,
  },
  {
    id: 'ad_policy.before_after',
    pack: 'ad_policy',
    severity: 'warning',
    description: 'Before/after transformation framing — restricted in Meta/Google ad policy.',
    pattern: /\bbefore\s+and\s+after\b|\bafter\s+(?:photo|picture|shot)s?\b|\btransformation\s+(?:photo|picture)s?\b/i,
  },
  {
    id: 'ad_policy.sensational',
    pack: 'ad_policy',
    severity: 'warning',
    description: 'Sensational/clickbait phrasing flagged by ad review ("doctors hate", "miracle", "one weird trick", "shocking").',
    pattern: /\b(?:doctors\s+hate|one\s+weird\s+trick|miracle\s+(?:cure|fix|solution)|shocking\s+(?:truth|secret|discovery)|banned\s+(?:video|secret))\b/i,
  },
];

export type ComplianceMode = 'none' | 'health' | 'finance';

/** Packs applied for a given compliance mode. FTC + ad policy always apply. */
export function packsForMode(mode: ComplianceMode): CompliancePack[] {
  const base: CompliancePack[] = ['ftc', 'ad_policy'];
  if (mode === 'health') base.push('health');
  if (mode === 'finance') base.push('finance');
  return base;
}

export interface ComplianceFinding {
  ruleId: string;
  pack: CompliancePack;
  severity: ComplianceSeverity;
  /** Line ref: the block carrying the violation… */
  blockId: string;
  /** …and the matched excerpt inside it. */
  excerpt: string;
  description: string;
}

/** Run the rule packs over a block-structured draft. Pure. */
export function runCompliancePacks(blocks: AssetBlock[], mode: ComplianceMode): ComplianceFinding[] {
  const packs = new Set(packsForMode(mode));
  const fullText = blocks.map((b) => b.text).join('\n\n');
  const findings: ComplianceFinding[] = [];
  for (const rule of COMPLIANCE_RULES) {
    if (!packs.has(rule.pack)) continue;
    if (rule.unlessPresent && rule.unlessPresent.test(fullText)) continue;
    for (const block of blocks) {
      const match = block.text.match(rule.pattern);
      if (match) {
        findings.push({
          ruleId: rule.id,
          pack: rule.pack,
          severity: rule.severity,
          blockId: block.id,
          excerpt: match[0]!.slice(0, 160),
          description: rule.description,
        });
      }
    }
  }
  return findings;
}

// --- Required-disclaimer inserter ---------------------------------------------------

export const REQUIRED_DISCLAIMERS: Record<Exclude<ComplianceMode, 'none'>, string> = {
  health:
    'This content is for educational purposes only and is not medical advice. These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease. Individual results may vary.',
  finance:
    'Results may vary. Past performance does not guarantee future results. Nothing here is financial advice, and there is no guarantee of income or returns. Your results depend on your situation, effort, and market conditions.',
};

const DISCLAIMER_BLOCK_ID = 'compliance-disclaimer';

export function hasRequiredDisclaimer(blocks: AssetBlock[], mode: ComplianceMode): boolean {
  if (mode === 'none') return true;
  if (blocks.some((b) => (b.meta as { section?: string } | undefined)?.section === 'disclaimer')) return true;
  const marker = mode === 'finance' ? /results\s+may\s+vary|past\s+performance/i : /not\s+medical\s+advice|not\s+intended\s+to\s+diagnose/i;
  return marker.test(blocks.map((b) => b.text).join('\n'));
}

/** Append the mode's required disclaimer block if missing. Idempotent. */
export function insertRequiredDisclaimer(
  blocks: AssetBlock[],
  mode: ComplianceMode,
): { blocks: AssetBlock[]; inserted: boolean } {
  if (mode === 'none' || hasRequiredDisclaimer(blocks, mode)) return { blocks, inserted: false };
  return {
    blocks: [
      ...blocks,
      {
        id: DISCLAIMER_BLOCK_ID,
        role: 'body',
        text: REQUIRED_DISCLAIMERS[mode],
        meta: { section: 'disclaimer', locked: true },
      },
    ],
    inserted: true,
  };
}

// --- Verdict ---------------------------------------------------------------------------

export interface ComplianceVerdict {
  pass: boolean;
  errors: ComplianceFinding[];
  /** Warnings not covered by an acknowledgment. */
  unacknowledgedWarnings: ComplianceFinding[];
  acknowledgedWarnings: ComplianceFinding[];
}

/**
 * G6 verdict over findings + acknowledgments. Acks apply per rule+block pair;
 * ERROR findings can never be acknowledged (spec: never for strict-mode
 * failures — those and pack errors always block).
 */
export function evaluateCompliance(
  findings: ComplianceFinding[],
  acknowledgedKeys: ReadonlySet<string>,
): ComplianceVerdict {
  const key = (f: ComplianceFinding) => `${f.ruleId}:${f.blockId}`;
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const acknowledged = warnings.filter((f) => acknowledgedKeys.has(key(f)));
  const unacknowledged = warnings.filter((f) => !acknowledgedKeys.has(key(f)));
  return {
    pass: errors.length === 0 && unacknowledged.length === 0,
    errors,
    unacknowledgedWarnings: unacknowledged,
    acknowledgedWarnings: acknowledged,
  };
}

export function complianceFindingKey(f: Pick<ComplianceFinding, 'ruleId' | 'blockId'>): string {
  return `${f.ruleId}:${f.blockId}`;
}
