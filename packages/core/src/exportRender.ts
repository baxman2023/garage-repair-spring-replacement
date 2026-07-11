import { createHash } from 'node:crypto';
import type { PageBuildPackage } from './contracts/pageBuildPackage.js';
import type { AssetBlock } from './blocks.js';

/**
 * Export renderers (WO-036, pure). Every renderer is a deterministic function
 * of the package — exports are BYTE-reproducible (acceptance). Markdown for
 * everything; semantic unstyled HTML for written pages; 170-WPM teleprompter
 * TXT for spoken scripts; an .md pack for email sequences; and a
 * deterministic STORE-method ZIP with a checksum manifest.
 */

export interface ExportFile {
  filename: string;
  content: string;
  format: 'markdown' | 'html' | 'txt';
}

export function contentChecksum(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

function blocks(pkg: PageBuildPackage): AssetBlock[] {
  return pkg.copy_blocks as AssetBlock[];
}

// --- Markdown (always) ----------------------------------------------------------

export function renderMarkdown(pkg: PageBuildPackage): string {
  const lines: string[] = [
    `# ${pkg.scope.asset_type.replace(/_/g, ' ')} — package ${pkg.scope.asset}`,
    '',
    `> market ${pkg.scope.market} · project ${pkg.scope.project} · schema v${pkg.schema_version}`,
    '',
  ];
  for (const b of blocks(pkg)) {
    lines.push(`## ${b.id} (${b.role})`, '', b.text, '');
  }
  return lines.join('\n');
}

// --- Semantic HTML (letters / advertorials / quiz results) --------------------------

const HTML_TAG: Record<string, { open: string; close: string }> = {
  headline: { open: '<h1>', close: '</h1>' },
  subject: { open: '<h2>', close: '</h2>' },
  hook: { open: '<h2>', close: '</h2>' },
  bullets: { open: '<ul>', close: '</ul>' },
  cta: { open: '<p class="cta"><a href="#order">', close: '</a></p>' },
};

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderHtml(pkg: PageBuildPackage): string {
  const body = blocks(pkg)
    .map((b) => {
      const tag = HTML_TAG[b.role];
      if (b.role === 'bullets') {
        const items = b.text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => `    <li>${escapeHtml(l.replace(/^[-*•]\s*/, ''))}</li>`)
          .join('\n');
        return `  <section data-block="${b.id}">\n    <ul>\n${items}\n    </ul>\n  </section>`;
      }
      const paragraphs = b.text
        .split(/\n{2,}/)
        .map((p) => escapeHtml(p.trim()))
        .filter(Boolean);
      const inner = tag
        ? `${tag.open}${paragraphs.join(' ')}${tag.close}`
        : paragraphs.map((p) => `<p>${p}</p>`).join('\n    ');
      return `  <section data-block="${b.id}" data-role="${b.role}">\n    ${inner}\n  </section>`;
    })
    .join('\n');

  const jsonLd = pkg.media.videoobject_schema
    ? `\n  <script type="application/ld+json">${JSON.stringify(pkg.media.videoobject_schema)}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(blocks(pkg)[0]?.text.slice(0, 80) ?? pkg.scope.asset_type)}</title>${jsonLd}
</head>
<body>
<main data-package-checksum-scope="${pkg.scope.asset}">
${body}
</main>
</body>
</html>
`;
}

// --- Teleprompter TXT (VSL / webinar) ------------------------------------------------

export function renderTeleprompter(pkg: PageBuildPackage): string {
  const bs = blocks(pkg);
  const stamped = bs.filter(
    (b) => typeof (b.meta as { timestampStart?: number } | undefined)?.timestampStart === 'number',
  );
  const totalEnd = stamped
    .map((b) => (b.meta as { timestampEnd?: number }).timestampEnd ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const lines: string[] = [
    '================ TELEPROMPTER ================',
    `ASSET: ${pkg.scope.asset_type}  ·  PACE: 170 WPM  ·  RUNTIME: ${fmtTime(totalEnd)}`,
    'Block timings derived at one hundred seventy words per minute.',
    '==============================================',
    '',
  ];
  for (const b of bs) {
    const meta = b.meta as { timestampStart?: number; timestampEnd?: number } | undefined;
    const timing =
      typeof meta?.timestampStart === 'number' && typeof meta?.timestampEnd === 'number'
        ? `[${fmtTime(meta.timestampStart)} → ${fmtTime(meta.timestampEnd)}]`
        : '[untimed]';
    lines.push(`${timing} ${b.id} · ${b.role}`, '', b.text, '', '----------------------------------------------', '');
  }
  return lines.join('\n');
}

// --- Email .md pack ---------------------------------------------------------------------

export function renderEmailPack(pkg: PageBuildPackage): ExportFile[] {
  const groups = new Map<string, AssetBlock[]>();
  for (const b of blocks(pkg)) {
    const section = (b.meta as { section?: string } | undefined)?.section ?? 'email';
    const list = groups.get(section) ?? [];
    list.push(b);
    groups.set(section, list);
  }
  const files: ExportFile[] = [];
  const indexLines = ['# Email sequence pack', ''];
  let n = 0;
  for (const [section, group] of groups) {
    n++;
    const offset = (group[0]!.meta as { sendOffsetHours?: number } | undefined)?.sendOffsetHours;
    const phase = (group[0]!.meta as { phase?: string } | undefined)?.phase;
    const subject = group.find((b) => b.role === 'subject')?.text ?? '';
    const preview = group.find((b) => b.role === 'preview')?.text ?? '';
    const body = group.find((b) => b.role === 'body')?.text ?? '';
    const filename = `${String(n).padStart(2, '0')}-${section}.md`;
    files.push({
      filename,
      format: 'markdown',
      content: [
        `# ${section}`,
        '',
        `- send offset: ${offset ?? '?'}h${phase ? ` · phase: ${phase}` : ''}`,
        `- subject: ${subject}`,
        `- preview: ${preview}`,
        '',
        '---',
        '',
        body,
        '',
      ].join('\n'),
    });
    indexLines.push(`- \`${filename}\` — +${offset ?? '?'}h${phase ? ` (${phase})` : ''}: ${subject}`);
  }
  files.unshift({ filename: '00-sequence.md', format: 'markdown', content: `${indexLines.join('\n')}\n` });
  return files;
}

// --- Per-asset dispatch ----------------------------------------------------------------

const HTML_TYPES = new Set(['sales_letter', 'advertorial']);
const TELEPROMPTER_TYPES = new Set(['vsl', 'webinar']);

/** All files for one asset's package (deterministic; acceptance). */
export function renderAssetFiles(pkg: PageBuildPackage): ExportFile[] {
  const type = pkg.scope.asset_type;
  const stem = `${type}-${pkg.scope.asset.slice(-8).toLowerCase()}`;
  if (type === 'email_sequence') {
    return renderEmailPack(pkg).map((f) => ({ ...f, filename: `${stem}/${f.filename}` }));
  }
  const files: ExportFile[] = [{ filename: `${stem}.md`, format: 'markdown', content: renderMarkdown(pkg) }];
  if (HTML_TYPES.has(type)) {
    files.push({ filename: `${stem}.html`, format: 'html', content: renderHtml(pkg) });
  }
  if (TELEPROMPTER_TYPES.has(type)) {
    files.push({ filename: `${stem}.txt`, format: 'txt', content: renderTeleprompter(pkg) });
  }
  return files;
}

// --- Deterministic STORE-method ZIP -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed DOS date/time (2020-01-01 00:00) so zips are byte-reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

/** Minimal, dependency-free, deterministic ZIP (STORE method, no compression). */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  const encoder = new TextEncoder();
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(data);
    const header = [
      ...u32(0x04034b50),
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // method: STORE
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra length
    ];
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
    chunks.push(...header, ...nameBytes, ...data);
    offset += header.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(central.length),
    ...u32(centralOffset),
    ...u16(0),
  ];
  return Uint8Array.from([...chunks, ...central, ...end]);
}

/** Read a STORE zip back (tests + verification). Returns name → content bytes. */
export function readStoreZip(zip: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (offset + 4 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(zip.slice(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    out.set(name, zip.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return out;
}
