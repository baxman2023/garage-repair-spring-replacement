import { describe, expect, it } from 'vitest';
import { parseEmailMetricsCsv } from './emailCsv.js';

const CSV = [
  'email,type,occurred_at,market_id',
  'a@example.com,open,2026-07-01T10:00:00Z,',
  'a@example.com,click,2026-07-01T10:05:00Z,',
  'b@example.com,OPEN,2026-07-02T09:00:00Z,',
  'not-an-email,open,2026-07-01T10:00:00Z,',
  'c@example.com,unsubscribe,2026-07-01T10:00:00Z,',
  'd@example.com,open,yesterday,',
  'e@example.com,open,2026-07-01T10:00:00Z,short-id',
].join('\n');

describe('email metrics CSV (WO-043)', () => {
  it('parses good rows (case-insensitive type) and triages bad ones with reasons', () => {
    const result = parseEmailMetricsCsv(CSV);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ email: 'a@example.com', type: 'email_open', marketId: null });
    expect(result.rows[1]!.type).toBe('email_click');
    expect(result.rows[2]!.type).toBe('email_open'); // OPEN normalized

    expect(result.bad).toHaveLength(4);
    expect(result.bad.map((b) => b.reason).join(' ')).toMatch(/invalid email/);
    expect(result.bad.map((b) => b.reason).join(' ')).toMatch(/Unknown metric type "unsubscribe"/);
    expect(result.bad.map((b) => b.reason).join(' ')).toMatch(/Unparseable occurred_at/);
    expect(result.bad.map((b) => b.reason).join(' ')).toMatch(/not a valid id/);
  });

  it('dedupe keys are deterministic per (email, type, time)', () => {
    const a = parseEmailMetricsCsv(CSV).rows[0]!;
    const b = parseEmailMetricsCsv(CSV).rows[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(a.dedupeKey).toMatch(/^email:[0-9a-f]{40}$/);
    expect(parseEmailMetricsCsv(CSV).rows[1]!.dedupeKey).not.toBe(a.dedupeKey);
  });
});
