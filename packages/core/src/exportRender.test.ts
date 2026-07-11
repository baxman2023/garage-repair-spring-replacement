import { describe, expect, it } from 'vitest';
import type { AssetBlock } from './blocks.js';
import { parseMarketProfile } from './contracts/marketProfile.js';
import { composePageBuildPackage } from './packageCompose.js';
import {
  contentChecksum,
  crc32,
  readStoreZip,
  renderAssetFiles,
  renderEmailPack,
  renderHtml,
  renderMarkdown,
  renderTeleprompter,
  zipStore,
} from './exportRender.js';

const profile = parseMarketProfile({
  schema_version: '1',
  rank: 1,
  label: 'Homeowners',
  avatar: { age_range: '30-45', identity: 'homeowner', situation: 'screech' },
  starving_crowd_scores: { pain: 8, purchasing_power: 7, reachability: 6, urgency: 8, ltv: 4, total: 71 },
  awareness_stage: 'problem',
  awareness_justification: 'x',
  sophistication: 2,
  sophistication_justification: 'x',
  resident_emotion: 'dread',
  core_desire: 'forget the door',
  objections: ['a', 'b', 'c', 'd', 'e'],
  voc_corpus_ref: '',
  channels_ranked: ['search'],
  entry_conversation: 'snap?',
});

const ID = '0'.repeat(26);
const pkgOf = (assetType: string, blocks: AssetBlock[]) =>
  composePageBuildPackage({ scope: { project: ID, market: ID, asset: ID, assetType }, blocks, profile, title: 'SpringGuard' });

const LETTER = pkgOf('sales_letter', [
  { id: 'hl', role: 'headline', text: 'The Six A.M. Snap & <Trap>' },
  { id: 'bullets', role: 'bullets', text: '- ten thousand cycles\n- one visit fix' },
  { id: 'offer', role: 'offer', text: 'Everything included.\n\nOne visit.' },
  { id: 'cta', role: 'cta', text: 'Book the fix' },
]);
const VSL = pkgOf('vsl', [
  { id: 'hook', role: 'hook', text: 'The bang.', meta: { timestampStart: 0, timestampEnd: 12.4 } },
  { id: 'offer', role: 'offer', text: 'The kit.', meta: { timestampStart: 12.4, timestampEnd: 90 } },
  { id: 'cta', role: 'cta', text: 'Book.', meta: { timestampStart: 90, timestampEnd: 154 } },
]);
const EMAILS = pkgOf('email_sequence', [
  { id: 'w1-s', role: 'subject', text: 'The spring truth', meta: { section: 'w-1', sendOffsetHours: 0 } },
  { id: 'w1-p', role: 'preview', text: 'What installers skip', meta: { section: 'w-1', sendOffsetHours: 0 } },
  { id: 'w1-b', role: 'body', text: 'It snapped at six. {{cta_link}}', meta: { section: 'w-1', sendOffsetHours: 0 } },
  { id: 'w2-s', role: 'subject', text: 'Day two', meta: { section: 'w-2', sendOffsetHours: 24 } },
  { id: 'w2-p', role: 'preview', text: 'The cycle math', meta: { section: 'w-2', sendOffsetHours: 24 } },
  { id: 'w2-b', role: 'body', text: 'Ten thousand cycles. {{cta_link}}', meta: { section: 'w-2', sendOffsetHours: 24 } },
]);

describe('export renderers (WO-036) — byte-reproducible', () => {
  it('renders are deterministic byte-for-byte', () => {
    expect(renderMarkdown(LETTER)).toBe(renderMarkdown(LETTER));
    expect(renderHtml(LETTER)).toBe(renderHtml(LETTER));
    expect(renderTeleprompter(VSL)).toBe(renderTeleprompter(VSL));
    expect(contentChecksum(renderMarkdown(LETTER))).toBe(contentChecksum(renderMarkdown(LETTER)));
  });

  it('markdown carries every block; html is semantic and escaped', () => {
    const md = renderMarkdown(LETTER);
    expect(md).toContain('## hl (headline)');
    expect(md).toContain('The Six A.M. Snap & <Trap>');

    const html = renderHtml(LETTER);
    expect(html).toContain('<h1>The Six A.M. Snap &amp; &lt;Trap&gt;</h1>');
    expect(html).toContain('<li>ten thousand cycles</li>');
    expect(html).toContain('data-block="offer"');
    expect(html).toContain('<p>Everything included.</p>'); // paragraphs split
    expect(html).not.toContain('<script'); // letters carry no VideoObject
  });

  it('teleprompter has the 170-WPM header and per-block timings', () => {
    const txt = renderTeleprompter(VSL);
    expect(txt).toContain('PACE: 170 WPM');
    expect(txt).toContain('RUNTIME: 02:34'); // 154s
    expect(txt).toContain('[00:00 → 00:12] hook · hook');
    expect(txt).toContain('[01:30 → 02:34] cta · cta');
  });

  it('email pack: one md per email plus a sequence index with offsets', () => {
    const files = renderEmailPack(EMAILS);
    expect(files.map((f) => f.filename)).toEqual(['00-sequence.md', '01-w-1.md', '02-w-2.md']);
    expect(files[0]!.content).toContain('`01-w-1.md` — +0h: The spring truth');
    expect(files[2]!.content).toContain('- send offset: 24h');
    expect(files[2]!.content).toContain('Ten thousand cycles. {{cta_link}}');
  });

  it('per-asset dispatch: md always; html for letters; txt for VSL; pack for emails', () => {
    expect(renderAssetFiles(LETTER).map((f) => f.format)).toEqual(['markdown', 'html']);
    expect(renderAssetFiles(VSL).map((f) => f.format)).toEqual(['markdown', 'txt']);
    expect(renderAssetFiles(EMAILS).every((f) => f.format === 'markdown')).toBe(true);
    expect(renderAssetFiles(EMAILS)[0]!.filename).toMatch(/^email_sequence-[a-z0-9]+\/00-sequence\.md$/);
  });
});

describe('deterministic STORE zip', () => {
  const entries = [
    { name: 'manifest.json', content: '{"a":1}\n' },
    { name: 'dir/file.md', content: '# hello\n' },
  ];

  it('produces identical bytes across runs and round-trips', () => {
    const a = zipStore(entries);
    const b = zipStore(entries);
    expect(contentChecksum(a)).toBe(contentChecksum(b)); // byte-reproducible

    const read = readStoreZip(a);
    expect([...read.keys()]).toEqual(['manifest.json', 'dir/file.md']);
    expect(new TextDecoder().decode(read.get('dir/file.md'))).toBe('# hello\n');
  });

  it('crc32 matches the known vector', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });
});
