import { describe, expect, it } from 'vitest';
import { REDACTED, installConsoleRedaction, redact } from './redact.js';

const FAKE_KEY = 'sk-ant-api03-abcDEF123456_ghijklmnop-qrstuv';

describe('redact', () => {
  it('scrubs Anthropic keys from strings', () => {
    const out = redact(`using key ${FAKE_KEY} now`);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain('sk-ant');
  });

  it('scrubs keys from Error messages', () => {
    const out = redact(new Error(`401 unauthorized for ${FAKE_KEY}`));
    expect(out).not.toContain(FAKE_KEY);
    expect(out).toContain(REDACTED);
  });

  it('scrubs keys from objects', () => {
    const out = redact({ authorization: `Bearer ${FAKE_KEY}` });
    expect(out).not.toContain(FAKE_KEY);
  });

  it('leaves non-secret text intact', () => {
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });
});

describe('installConsoleRedaction', () => {
  it('redacts keys from console output', () => {
    const received: string[] = [];
    const original = console.log;
    // Install redaction over a recording sink so we can inspect what is emitted.
    console.log = (...args: unknown[]) => {
      received.push(args.map(String).join(' '));
    };
    installConsoleRedaction();
    console.log(`leaked ${FAKE_KEY}`);
    console.log = original;

    const emitted = received.join('');
    expect(emitted).not.toContain(FAKE_KEY);
    expect(emitted).toContain(REDACTED);
  });
});
