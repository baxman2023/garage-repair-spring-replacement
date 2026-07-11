import { describe, expect, it } from 'vitest';
import { extractReadableText } from './readability.js';
import { extractJsonObject } from './jsonExtract.js';

describe('extractReadableText', () => {
  it('extracts title and body, dropping scripts/styles/head', () => {
    const html = `<!doctype html><html><head><title>Garage &amp; Door Co</title>
      <style>body{color:red}</style></head>
      <body><script>alert('x')</script>
      <h1>Spring Replacement</h1>
      <p>Torsion springs last 10,000 cycles.</p>
      <ul><li>Fast service</li><li>Fair &quot;pricing&quot;</li></ul>
      <div>Call now &mdash; today</div></body></html>`;
    const { title, text } = extractReadableText(html);
    expect(title).toBe('Garage & Door Co');
    expect(text).toContain('Spring Replacement');
    expect(text).toContain('Torsion springs last 10,000 cycles.');
    expect(text).toContain('Fast service');
    expect(text).toContain('Fair "pricing"');
    expect(text).toContain('Call now — today');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('handles pages without a title', () => {
    const { title, text } = extractReadableText('<p>hello<br>world</p>');
    expect(title).toBe('');
    expect(text).toBe('hello\nworld');
  });
});

describe('extractJsonObject', () => {
  it('parses bare JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses fenced JSON with prose around it', () => {
    const out = extractJsonObject('Here you go:\n```json\n{"name":"X","n":2}\n```\nDone.');
    expect(out).toEqual({ name: 'X', n: 2 });
  });

  it('handles braces inside strings', () => {
    expect(extractJsonObject('{"s":"a { tricky } string"} trailing')).toEqual({
      s: 'a { tricky } string',
    });
  });

  it('throws when no object exists', () => {
    expect(() => extractJsonObject('no json here')).toThrow();
    expect(() => extractJsonObject('{"unbalanced":')).toThrow();
  });
});
