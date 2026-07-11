import type { PageBuildPackage } from './contracts/pageBuildPackage.js';
import type { AssetBlock } from './blocks.js';

/**
 * Macaly prompt compiler (WO-037, pure). Renders the versioned registry
 * template ("macaly.build") into one-shot build prompt(s): page goal,
 * section-by-section VERBATIM copy injection fenced with DO-NOT-REWRITE
 * markers, design-brief directives, mobile-first + load-speed directives,
 * schema/quiz/CTA wiring, and the final self-check list. When the compiled
 * prompt exceeds the practical length budget (config), it SPLITS into a build
 * prompt plus refine prompts — the union always carries 100% of the copy
 * blocks verbatim (asserted, fail-closed).
 */

/** Macaly practical single-prompt budget, in characters (config). */
export const DEFAULT_MACALY_BUDGET_CHARS = 24_000;

export interface MacalyCompileResult {
  /** 1 prompt when it fits; build + refine prompts when split. */
  prompts: string[];
  split: boolean;
  totalChars: number;
}

const FENCE_OPEN = '<<<COPY — DO-NOT-REWRITE — inject character-for-character>>>';
const FENCE_CLOSE = '<<<END COPY>>>';

function sectionBlock(b: AssetBlock, section: string, directive: string): string {
  return [
    `### Section "${section}" (block ${b.id} · ${b.role})`,
    `Design: ${directive}`,
    FENCE_OPEN,
    b.text,
    FENCE_CLOSE,
  ].join('\n');
}

function renderSections(pkg: PageBuildPackage, blocks: AssetBlock[]): string[] {
  const sectionOf = new Map(pkg.design_brief.section_map.map((s) => [s.block_id, s.section]));
  const directiveOf = new Map(pkg.design_brief.visual_hierarchy.map((v) => [v.section, v.directive]));
  return blocks.map((b) => {
    const section = sectionOf.get(b.id) ?? b.id;
    return sectionBlock(b, section, directiveOf.get(section) ?? 'Plain reading typography.');
  });
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}

/** Every copy block must appear VERBATIM in the union of prompts (acceptance). */
export function assertBlocksVerbatim(prompts: string[], blocks: AssetBlock[]): void {
  const union = prompts.join('\n');
  const missing = blocks.filter((b) => !union.includes(b.text));
  if (missing.length > 0) {
    throw new Error(
      `Macaly compile violation: ${missing.length} copy block(s) not carried verbatim: ${missing.map((b) => b.id).join(', ')}.`,
    );
  }
}

function commonVars(pkg: PageBuildPackage): Record<string, string> {
  const blocks = pkg.copy_blocks as AssetBlock[];
  const cta = blocks.find((b) => b.role === 'cta');
  return {
    page_goal: `A ${pkg.scope.asset_type.replace(/_/g, ' ')} page whose single job is moving the reader to the CTA. Tone: ${pkg.design_brief.tone}.`,
    cta_wiring: [
      `Sticky CTA appears at: ${pkg.design_brief.cta_choreography.sticky_cta_at}.`,
      `Buy button reveals at: ${pkg.design_brief.cta_choreography.buy_reveal_at}.`,
      cta ? `The ONLY CTA action, verbatim label: "${cta.text}". One destination, no competing links.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    schema_embed: pkg.media.videoobject_schema
      ? `Embed EXACTLY this JSON-LD in a <script type="application/ld+json"> tag in <head>:\n${JSON.stringify(pkg.media.videoobject_schema)}`
      : 'No structured-data embed for this page.',
    quiz_embed: pkg.quiz_embed
      ? `Embed the quiz where the design brief places it. Snippet reference: "${pkg.quiz_embed.snippet_ref}" — insert the provided embed snippet unmodified.`
      : 'No quiz embed on this page.',
    self_check: [...pkg.acceptance_criteria, ...pkg.self_qa_checklist].map((c) => `- ${c}`).join('\n'),
  };
}

/**
 * Compile the Macaly prompt(s) from the registry template. Template
 * placeholders: {{page_goal}} {{sections}} {{cta_wiring}} {{schema_embed}}
 * {{quiz_embed}} {{self_check}} {{part_note}}.
 */
export function compileMacalyPrompt(
  pkg: PageBuildPackage,
  template: string,
  budgetChars: number = DEFAULT_MACALY_BUDGET_CHARS,
): MacalyCompileResult {
  const blocks = pkg.copy_blocks as AssetBlock[];
  const sections = renderSections(pkg, blocks);
  const vars = commonVars(pkg);

  const single = fillTemplate(template, { ...vars, sections: sections.join('\n\n'), part_note: '' });
  if (single.length <= budgetChars) {
    assertBlocksVerbatim([single], blocks);
    return { prompts: [single], split: false, totalChars: single.length };
  }

  // Overflow strategy: build prompt with as many leading sections as fit,
  // then refine prompts carrying the remaining sections verbatim.
  const overheadProbe = fillTemplate(template, { ...vars, sections: '', part_note: '' }).length;
  const budgetForSections = Math.max(2_000, budgetChars - overheadProbe - 400);

  const parts: string[][] = [[]];
  let used = 0;
  for (const section of sections) {
    if (used + section.length > budgetForSections && parts[parts.length - 1]!.length > 0) {
      parts.push([]);
      used = 0;
    }
    parts[parts.length - 1]!.push(section);
    used += section.length + 2;
  }

  const prompts = parts.map((part, i) => {
    const partNote =
      i === 0
        ? `PART 1 of ${parts.length}: BUILD the full page structure now, with the sections below. Leave clearly-marked placeholders ONLY for the sections named in later parts — every section provided here is final copy.`
        : `PART ${i + 1} of ${parts.length}: REFINE the page you just built. Replace the corresponding placeholders with these sections — copy is final, inject verbatim. Change nothing else.`;
    return fillTemplate(template, { ...vars, sections: part.join('\n\n'), part_note: partNote });
  });

  assertBlocksVerbatim(prompts, blocks);
  return { prompts, split: true, totalChars: prompts.reduce((a, p) => a + p.length, 0) };
}

/** Join split prompts for single-field storage (renderings.macaly_prompt). */
export function joinPromptParts(prompts: string[]): string {
  if (prompts.length === 1) return prompts[0]!;
  return prompts
    .map((p, i) => `===== MACALY PROMPT ${i + 1} of ${prompts.length} =====\n\n${p}`)
    .join('\n\n');
}
