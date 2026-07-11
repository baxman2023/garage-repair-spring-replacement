import { z } from 'zod';
import { findAiTells } from '../aiTells.js';

/**
 * Email-sequence contract (WO-026): the owned-audience engine. Four sequence
 * kinds per market, each persisted as one `email_sequence` asset whose version
 * meta carries the sequence graph (send-offset metadata). Subjects must pass
 * the G5 AI-tell scrub at generation time; every body carries exactly one CTA.
 */

// --- Merge fields ------------------------------------------------------------

/**
 * Merge-field conventions (documented in docs/merge-fields.md). Double-brace
 * tokens, snake_case. Any token outside this list is contract-invalid — ESPs
 * silently ship unknown tokens as literal text, so unknowns fail closed here.
 */
export const MERGE_FIELDS: readonly { name: string; description: string }[] = [
  { name: 'first_name', description: "Subscriber's first name; ESPs must configure a fallback (e.g. 'friend')." },
  { name: 'cta_link', description: 'THE call-to-action URL. Exactly one per email body — single-CTA rule.' },
  { name: 'unsubscribe_link', description: 'List-unsubscribe URL (compliance; footer).' },
  { name: 'product_name', description: 'The offer/product display name.' },
  { name: 'founder_name', description: 'The founder/sender display name for signatures.' },
  { name: 'webinar_link', description: 'Webinar join/replay URL (webinar-adjacent emails only).' },
  { name: 'deadline_date', description: 'Human-readable close date for legitimate-urgency sequences.' },
];

const MERGE_FIELD_NAMES = new Set(MERGE_FIELDS.map((f) => f.name));
const MERGE_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** All merge-field tokens appearing in the text (with duplicates, in order). */
export function extractMergeFields(text: string): string[] {
  return [...text.matchAll(MERGE_TOKEN_RE)].map((m) => m[1]!);
}

/** Tokens that are not part of the documented conventions. */
export function findUnknownMergeFields(text: string): string[] {
  return [...new Set(extractMergeFields(text).filter((name) => !MERGE_FIELD_NAMES.has(name)))];
}

// --- Sequence kinds -----------------------------------------------------------

export const SEQUENCE_KINDS = ['welcome', 'launch', 'cart_abandon', 'daily_infotainment'] as const;
export type SequenceKind = (typeof SEQUENCE_KINDS)[number];

export const LAUNCH_PHASES = ['seed', 'open', 'close'] as const;
export type LaunchPhase = (typeof LAUNCH_PHASES)[number];

/** Per-kind cardinality (spec WO-026 deliverables). */
export const SEQUENCE_SPECS: Record<SequenceKind, { min: number; max: number; label: string }> = {
  welcome: { min: 5, max: 7, label: 'indoctrination/welcome' },
  launch: { min: 9, max: 9, label: 'launch seed→open→close' },
  cart_abandon: { min: 3, max: 3, label: 'cart abandon' },
  daily_infotainment: { min: 10, max: 10, label: 'daily infotainment templates (founder voice)' },
};

export const sequenceEmailSchema = z.object({
  id: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  preview: z.string().trim().min(1),
  body: z.string().trim().min(1),
  /** Send offset from sequence start (welcome/launch/daily) or trigger (cart abandon), in hours. */
  send_offset_hours: z.number().nonnegative(),
  /** Launch emails only: which act of seed→open→close this email belongs to. */
  phase: z.enum(LAUNCH_PHASES).optional(),
});
export type SequenceEmail = z.infer<typeof sequenceEmailSchema>;

export const emailSequenceResultSchema = z.object({
  emails: z
    .array(sequenceEmailSchema)
    .min(1)
    .refine((emails) => new Set(emails.map((e) => e.id)).size === emails.length, {
      message: 'Email ids must be unique',
    }),
});

/**
 * Full WO-026 validation for one sequence. Throws with a precise reason:
 * cardinality, send-offset monotonicity, launch phase structure, single-CTA,
 * unknown merge fields, and the G5 AI-tell scrub on subjects.
 */
export function validateEmailSequence(kind: SequenceKind, emails: SequenceEmail[]): void {
  const spec = SEQUENCE_SPECS[kind];
  if (emails.length < spec.min || emails.length > spec.max) {
    const want = spec.min === spec.max ? `exactly ${spec.min}` : `${spec.min}-${spec.max}`;
    throw new Error(`Sequence "${kind}" must have ${want} emails; got ${emails.length}.`);
  }

  let prevOffset = -1;
  let prevPhaseIndex = 0;
  const phasesSeen = new Set<LaunchPhase>();
  for (const email of emails) {
    // Send-offset graph: strictly increasing through the sequence.
    if (email.send_offset_hours <= prevOffset) {
      throw new Error(
        `Sequence "${kind}": send offsets must strictly increase ("${email.id}" at ${email.send_offset_hours}h after ${prevOffset}h).`,
      );
    }
    prevOffset = email.send_offset_hours;

    if (kind === 'launch') {
      if (!email.phase) throw new Error(`Launch email "${email.id}" is missing its seed/open/close phase.`);
      const phaseIndex = LAUNCH_PHASES.indexOf(email.phase);
      if (phaseIndex < prevPhaseIndex) {
        throw new Error(`Launch phases must run seed→open→close; "${email.id}" moves backwards to "${email.phase}".`);
      }
      prevPhaseIndex = phaseIndex;
      phasesSeen.add(email.phase);
    }

    // G5 AI-tell scrub on the subject (WO-026 acceptance).
    const tells = findAiTells(email.subject);
    if (tells.length > 0) {
      throw new Error(`Subject of "${email.id}" fails the AI-tell scrub: ${tells.join(', ')}.`);
    }

    // Single-CTA rule: exactly one {{cta_link}} in the body.
    const ctas = extractMergeFields(email.body).filter((f) => f === 'cta_link').length;
    if (ctas !== 1) {
      throw new Error(`Email "${email.id}" must contain exactly one {{cta_link}}; found ${ctas}.`);
    }

    // Merge-field conventions: unknown tokens fail closed.
    for (const field of ['subject', 'preview', 'body'] as const) {
      const unknown = findUnknownMergeFields(email[field]);
      if (unknown.length > 0) {
        throw new Error(`Email "${email.id}" ${field} uses undocumented merge fields: ${unknown.join(', ')}.`);
      }
    }
    // Subjects may personalize with {{first_name}} only (docs/merge-fields.md).
    const subjectTokens = extractMergeFields(email.subject).filter((f) => f !== 'first_name');
    if (subjectTokens.length > 0) {
      throw new Error(`Subject of "${email.id}" may only use {{first_name}}; found: ${subjectTokens.join(', ')}.`);
    }
  }

  if (kind === 'launch' && phasesSeen.size !== LAUNCH_PHASES.length) {
    const missing = LAUNCH_PHASES.filter((p) => !phasesSeen.has(p));
    throw new Error(`Launch sequence is missing phase(s): ${missing.join(', ')}.`);
  }
}

/** The persisted sequence graph (asset-version meta): the send-offset schedule. */
export function sequenceGraph(kind: SequenceKind, emails: SequenceEmail[]): {
  kind: SequenceKind;
  emails: { id: string; send_offset_hours: number; phase?: LaunchPhase }[];
} {
  return {
    kind,
    emails: emails.map((e) => ({
      id: e.id,
      send_offset_hours: e.send_offset_hours,
      ...(e.phase ? { phase: e.phase } : {}),
    })),
  };
}
