import { canonicalStringify, snapshotHash } from './snapshot.js';
import type { AssetBlock } from './blocks.js';
import type { MarketProfile } from './contracts/marketProfile.js';
import {
  PACKAGE_SCHEMA_VERSION,
  parsePageBuildPackage,
  type PageBuildPackage,
  type PackageDesignBrief,
  type PackageUtmVariant,
} from './contracts/pageBuildPackage.js';

/**
 * Page Build Package composer (WO-035, pure). Everything here is
 * DETERMINISTIC: same inputs → byte-identical package → stable checksum.
 * The design brief maps the visual hierarchy onto the persuasion sequence;
 * CTA choreography keys off VSL timestamps or letter blocks; VideoObject
 * JSON-LD is derived from the script's 170-WPM stamps.
 */

const SPOKEN_TYPES = new Set(['vsl', 'webinar', 'short_form_video', 'youtube_ad']);

/** Visual weight per persuasion role (5 = dominant). */
const ROLE_WEIGHT: Record<string, number> = {
  headline: 5,
  hook: 5,
  lead: 4,
  story: 3,
  mechanism: 4,
  proof: 4,
  bullets: 3,
  offer: 5,
  close: 4,
  cta: 5,
  ps: 2,
  subject: 2,
  preview: 1,
  body: 2,
  question: 3,
};

const ROLE_DIRECTIVE: Record<string, string> = {
  headline: 'Dominant type, high contrast, zero competing elements above it.',
  hook: 'Instant focal point; nothing above the fold competes with it.',
  lead: 'Comfortable reading measure (~65ch); no sidebar distractions.',
  story: 'Narrow column, generous line height — this must READ, not skim.',
  mechanism: 'Support with one diagram-style visual slot; name the mechanism verbatim.',
  proof: 'Visually distinct proof strip (border or background shift); keep claims adjacent to their proof.',
  bullets: 'Scannable list with tight rhythm; one fascination per line, no paragraph walls.',
  offer: 'Boxed stack presentation; every line of the value stack on its own row with its value.',
  close: 'Slow the page down: more whitespace, single column, no navigation.',
  cta: 'Single dominant button; exact CTA copy verbatim; repeated only where the script repeats it.',
  ps: 'Set apart from the close; reads as a personal note.',
  body: 'Plain reading typography.',
  question: 'One question per screen; large touch targets.',
};

function sectionOf(block: AssetBlock, index: number): string {
  const metaSection = (block.meta as { section?: string } | undefined)?.section;
  return metaSection ?? `${block.role}-${index + 1}`;
}

/** Design brief mapped onto the persuasion sequence (deterministic). */
export function buildDesignBrief(
  blocks: AssetBlock[],
  assetType: string,
  profile: MarketProfile,
): PackageDesignBrief {
  const spoken = SPOKEN_TYPES.has(assetType);

  // CTA choreography: video pages key off timestamps, written pages off blocks.
  const offerBlock = blocks.find((b) => b.role === 'offer');
  const ctaBlock = blocks.find((b) => b.role === 'cta') ?? blocks[blocks.length - 1]!;
  let stickyCtaAt: string;
  let buyRevealAt: string;
  if (spoken) {
    const offerStart = (offerBlock?.meta as { timestampStart?: number } | undefined)?.timestampStart;
    const ctaStart = (ctaBlock.meta as { timestampStart?: number } | undefined)?.timestampStart;
    buyRevealAt = `t:${(offerStart ?? ctaStart ?? 0).toFixed(1)}`;
    // Sticky CTA appears one beat before the buy reveal (never before 30s).
    const sticky = Math.max(30, (offerStart ?? ctaStart ?? 30) - 15);
    stickyCtaAt = `t:${sticky.toFixed(1)}`;
  } else {
    buyRevealAt = `block:${(offerBlock ?? ctaBlock).id}`;
    stickyCtaAt = `block:${(blocks.find((b) => b.role === 'proof') ?? offerBlock ?? ctaBlock).id}`;
  }

  return {
    visual_hierarchy: blocks.map((b, i) => ({
      section: sectionOf(b, i),
      directive: ROLE_DIRECTIVE[b.role] ?? 'Plain reading typography.',
      weight: ROLE_WEIGHT[b.role] ?? 2,
    })),
    cta_choreography: { sticky_cta_at: stickyCtaAt, buy_reveal_at: buyRevealAt },
    tone: `${profile.resident_emotion} → ${profile.core_desire}; awareness ${profile.awareness_stage}, sophistication ${profile.sophistication}/5`,
    section_map: blocks.map((b, i) => ({ block_id: b.id, section: sectionOf(b, i) })),
  };
}

/** VideoObject JSON-LD for VSL/webinar pages (from 170-WPM stamps). */
export function buildVideoObject(
  blocks: AssetBlock[],
  assetType: string,
  title: string,
): PageBuildPackage['media']['videoobject_schema'] {
  if (!SPOKEN_TYPES.has(assetType)) return null;
  const last = [...blocks]
    .map((b) => (b.meta as { timestampEnd?: number } | undefined)?.timestampEnd ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  if (last <= 0) return null;
  const minutes = Math.floor(last / 60);
  const seconds = Math.round(last % 60);
  const hook = blocks.find((b) => b.role === 'hook') ?? blocks[0]!;
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: title,
    description: hook.text.slice(0, 160),
    duration: `PT${minutes > 0 ? `${minutes}M` : ''}${seconds}S`,
    // Evergreen placeholder — the publisher stamps the real date at upload.
    uploadDate: '{{upload_date}}',
  };
}

/** Deterministic acceptance criteria derived from what the package contains. */
export function buildAcceptanceCriteria(pkg: {
  blocks: AssetBlock[];
  assetType: string;
  hasVideo: boolean;
  hasQuiz: boolean;
  variantCount: number;
}): string[] {
  const criteria = [
    `Every one of the ${pkg.blocks.length} copy blocks appears on the page VERBATIM — no paraphrasing, no truncation, no reordering.`,
    'The page renders correctly at 375px (mobile-first) with no horizontal scroll.',
    'Exactly one primary CTA action exists; its copy matches the cta block verbatim.',
    'CTA choreography follows the design brief (sticky CTA and buy reveal exactly where specified).',
    'Page loads under 2 seconds on a mid-range phone (no render-blocking assets).',
  ];
  if (pkg.hasVideo) {
    criteria.push('The VideoObject JSON-LD from media.videoobject_schema is embedded in a <script type="application/ld+json"> tag.');
  }
  if (pkg.hasQuiz) {
    criteria.push('The quiz embed snippet is placed where the design brief indicates and loads without blocking paint.');
  }
  if (pkg.variantCount > 0) {
    criteria.push(`All ${pkg.variantCount} message-match UTM variants swap the headline/lead without layout shift.`);
  }
  return criteria;
}

/** The self-QA checklist the building model must verify line-by-line. */
export function buildSelfQaChecklist(pkg: { blocks: AssetBlock[]; hasVideo: boolean }): string[] {
  const checklist = [
    'Diff every copy block against the source: character-identical, in contract order.',
    'Click every link and CTA target; none may 404 or point at a placeholder.',
    'View at 375px, 768px, and 1440px; confirm no clipped text or horizontal scroll.',
    'Confirm zero lorem ipsum, zero TODO markers, zero empty href="#" anchors.',
    'Read the page top to bottom once, aloud; flag anything that breaks the slippery slide.',
  ];
  if (pkg.hasVideo) checklist.push('Validate the JSON-LD with a structured-data linter; zero errors.');
  return checklist;
}

export interface ComposeInputs {
  scope: { project: string; market: string; asset: string; assetType: string };
  blocks: AssetBlock[];
  profile: MarketProfile;
  /** Display title (product/offer name) for media schema. */
  title: string;
  utmVariants?: PackageUtmVariant[];
  quizSnippetRef?: string | null;
  renderings?: { file_paths: string[]; macaly_prompt: string; universal_llm_prompt: string };
}

/** Compose + contract-validate the package (pure, deterministic). */
export function composePageBuildPackage(inputs: ComposeInputs): PageBuildPackage {
  const videoObject = buildVideoObject(inputs.blocks, inputs.scope.assetType, inputs.title);
  const variants = inputs.utmVariants ?? [];
  const pkg = {
    schema_version: PACKAGE_SCHEMA_VERSION,
    scope: {
      project: inputs.scope.project,
      market: inputs.scope.market,
      asset: inputs.scope.asset,
      asset_type: inputs.scope.assetType,
    },
    copy_blocks: inputs.blocks,
    design_brief: buildDesignBrief(inputs.blocks, inputs.scope.assetType, inputs.profile),
    media: {
      videoobject_schema: videoObject,
      thumbnails_brief: videoObject
        ? 'Freeze-frame at the promise beat; high-contrast face or object; no text overlay beyond four words.'
        : '',
    },
    quiz_embed: inputs.quizSnippetRef ? { snippet_ref: inputs.quizSnippetRef } : null,
    message_match: { utm_variants: variants },
    acceptance_criteria: buildAcceptanceCriteria({
      blocks: inputs.blocks,
      assetType: inputs.scope.assetType,
      hasVideo: videoObject !== null,
      hasQuiz: Boolean(inputs.quizSnippetRef),
      variantCount: variants.length,
    }),
    self_qa_checklist: buildSelfQaChecklist({ blocks: inputs.blocks, hasVideo: videoObject !== null }),
    renderings: inputs.renderings ?? { file_paths: [], macaly_prompt: '', universal_llm_prompt: '' },
  };
  return parsePageBuildPackage(pkg);
}

/**
 * Package checksum (WO-035 acceptance: stable across identical inputs).
 * Renderings are EXCLUDED: they carry machine-local file paths and are filled
 * in after composition — the checksum identifies the deliverable CONTENT.
 */
export function packageChecksum(pkg: PageBuildPackage): string {
  const { renderings: _renderings, ...content } = pkg;
  return snapshotHash(JSON.parse(canonicalStringify(content)));
}
