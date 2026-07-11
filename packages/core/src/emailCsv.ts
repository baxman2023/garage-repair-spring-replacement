import { createHash } from 'node:crypto';

/**
 * Email metrics CSV import (WO-043, pure parse). Expected header:
 * `email,type,occurred_at[,market_id]` with type open|click. Bad rows are
 * returned (→ triage), never dropped. Each row carries a deterministic
 * dedupe key so re-imports collapse.
 */

export interface EmailMetricRow {
  email: string;
  type: 'email_open' | 'email_click';
  occurredAt: Date;
  marketId: string | null;
  dedupeKey: string;
}

export interface EmailCsvParseResult {
  rows: EmailMetricRow[];
  bad: Array<{ line: number; raw: string; reason: string }>;
}

export function parseEmailMetricsCsv(csv: string): EmailCsvParseResult {
  const lines = csv.split(/\r?\n/).map((l) => l.trim());
  const rows: EmailMetricRow[] = [];
  const bad: EmailCsvParseResult['bad'] = [];

  let start = 0;
  if (lines[0] && /^email\s*,/i.test(lines[0])) start = 1; // header

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw) continue;
    const cols = raw.split(',').map((c) => c.trim());
    const [email, type, occurredAt, marketId] = cols;
    if (!email || !email.includes('@')) {
      bad.push({ line: i + 1, raw, reason: 'Missing or invalid email address.' });
      continue;
    }
    const normalized = type?.toLowerCase();
    if (normalized !== 'open' && normalized !== 'click') {
      bad.push({ line: i + 1, raw, reason: `Unknown metric type "${type ?? ''}" (open|click).` });
      continue;
    }
    const when = occurredAt ? new Date(occurredAt) : null;
    if (!when || Number.isNaN(when.getTime())) {
      bad.push({ line: i + 1, raw, reason: `Unparseable occurred_at "${occurredAt ?? ''}".` });
      continue;
    }
    if (marketId && !/^[0-9A-Za-z]{26}$/.test(marketId)) {
      bad.push({ line: i + 1, raw, reason: `market_id "${marketId}" is not a valid id.` });
      continue;
    }
    rows.push({
      email,
      type: normalized === 'open' ? 'email_open' : 'email_click',
      occurredAt: when,
      marketId: marketId || null,
      dedupeKey: `email:${createHash('sha256').update(`${email}|${normalized}|${when.toISOString()}`).digest('hex').slice(0, 40)}`,
    });
  }
  return { rows, bad };
}
