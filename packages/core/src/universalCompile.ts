import type { PageBuildPackage } from './contracts/pageBuildPackage.js';
import type { AssetBlock } from './blocks.js';
import { assertBlocksVerbatim } from './macalyCompile.js';
import { canonicalStringify } from './snapshot.js';

/**
 * Universal LLM prompt compiler (WO-038, pure). Model-agnostic "build this
 * page" prompt from the registry template ("universal.build"): role framing,
 * the full package payload, explicit tech constraints per stack variant,
 * acceptance criteria, a line-by-line self-QA checklist, and the
 * zero-placeholders instruction. Copy blocks ride in plain-text fences (so
 * the verbatim guarantee is assertable) alongside the JSON payload.
 */

export const UNIVERSAL_STACKS = ['single-html', 'nextjs'] as const;
export type UniversalStack = (typeof UNIVERSAL_STACKS)[number];

const STACK_CONSTRAINTS: Record<UniversalStack, string> = {
  'single-html': [
    'Output ONE self-contained .html file: inline CSS in a single <style> block, inline JS in a single <script> block.',
    'No build step, no framework, no external requests (fonts, CDNs, trackers) — the file must render correctly from file://.',
    'System font stack. Semantic HTML5 landmarks. Total file under 200KB.',
  ].join('\n'),
  nextjs: [
    'Output a Next.js App Router implementation: the page in app/page.tsx plus any components it needs, each in its own file, with the full file tree stated first.',
    'TypeScript strict. Tailwind for styling. Server components by default; client components only where interaction demands it.',
    'No data fetching — all copy is embedded from the payload. Must pass `next build` with zero warnings.',
  ].join('\n'),
};

const FENCE_OPEN = '<<<COPY — DO-NOT-REWRITE — inject character-for-character>>>';
const FENCE_CLOSE = '<<<END COPY>>>';

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}

export function compileUniversalPrompt(
  pkg: PageBuildPackage,
  template: string,
  stack: UniversalStack = 'single-html',
): string {
  if (!UNIVERSAL_STACKS.includes(stack)) {
    throw new Error(`Unknown stack "${stack}" — use one of: ${UNIVERSAL_STACKS.join(', ')}.`);
  }
  const blocks = pkg.copy_blocks as AssetBlock[];

  const copySections = blocks
    .map((b) => [`### Block ${b.id} (${b.role})`, FENCE_OPEN, b.text, FENCE_CLOSE].join('\n'))
    .join('\n\n');

  // The payload minus copy text (design brief, media, choreography, variants) —
  // the copy itself travels in the fences above so it stays assertable.
  const { copy_blocks: _cb, renderings: _r, ...payloadRest } = pkg;
  const payload = canonicalStringify(payloadRest);

  const prompt = fillTemplate(template, {
    stack_name: stack,
    stack_constraints: STACK_CONSTRAINTS[stack],
    copy_sections: copySections,
    package_payload: payload,
    acceptance_criteria: pkg.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n'),
    self_qa: pkg.self_qa_checklist.map((c, i) => `${i + 1}. ${c}`).join('\n'),
  });

  assertBlocksVerbatim([prompt], blocks);
  return prompt;
}
