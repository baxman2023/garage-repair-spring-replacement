/**
 * Minimal readability extraction (WO-009 URL ingestion): reduce an HTML page
 * to its human-readable text. Dependency-free and pure — good enough for
 * intake dumps; not a general-purpose article extractor.
 */

const BLOCK_END = /<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre)>/gi;
const BR = /<br\s*\/?>/gi;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m] ?? ' ');
}

export interface ReadableExtract {
  title: string;
  text: string;
}

/** Extract the title and readable body text from an HTML document. */
export function extractReadableText(html: string): ReadableExtract {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).trim() : '';

  const text = decodeEntities(
    html
      // Drop non-content subtrees entirely.
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<template[\s\S]*?<\/template>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Preserve block structure as newlines, then strip all remaining tags.
      .replace(BR, '\n')
      .replace(BLOCK_END, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    // Collapse whitespace but keep paragraph breaks.
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  return { title, text };
}
