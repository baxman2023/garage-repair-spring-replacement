import { describe, expect, it } from 'vitest';
import { buildErrorEvent, parseSentryDsn } from './errorReport.js';
import { REDACTED } from './redact.js';

describe('error reporting with verified key redaction (WO-056)', () => {
  it('scrubs API keys from message, stack, and tags BEFORE the event leaves', () => {
    const key = 'sk-ant-api03-verysecretkeymaterial123456';
    const err = new Error(`Anthropic rejected key ${key} (401)`);
    err.stack = `Error: bad key ${key}\n    at generate (client.ts:1:1)`;

    const event = buildErrorEvent(err, { jobType: 'asset.generate', hint: `retry with ${key}` });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain('verysecretkeymaterial');
    expect((event.message as { formatted: string }).formatted).toContain(REDACTED);
    expect((event.extra as { stack: string }).stack).toContain(REDACTED);
    expect((event.tags as Record<string, string>).hint).toContain(REDACTED);
    expect((event.tags as Record<string, string>).jobType).toBe('asset.generate');
  });

  it('parses DSNs into the store endpoint; garbage yields null (console fallback)', () => {
    const dsn = parseSentryDsn('https://abc123@o450.ingest.sentry.io/123456');
    expect(dsn).toEqual({
      storeUrl: 'https://o450.ingest.sentry.io/api/123456/store/',
      publicKey: 'abc123',
    });
    expect(parseSentryDsn('not-a-dsn')).toBeNull();
  });
});
