import { describe, expect, it } from 'vitest';
import { isOverloaded, toSystemParam } from './transport.js';

describe('toSystemParam (cache blocks, spec §1.2)', () => {
  it('returns undefined for empty input', () => {
    expect(toSystemParam(undefined)).toBeUndefined();
    expect(toSystemParam([])).toBeUndefined();
  });

  it('marks only cached blocks with ephemeral cache_control', () => {
    const out = toSystemParam([
      { text: 'persona corpus', cache: true },
      { text: 'dynamic user block' },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'persona corpus', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'dynamic user block' },
    ]);
  });
});

describe('isOverloaded', () => {
  it('is true only for 429 / 529', () => {
    expect(isOverloaded({ status: 429 })).toBe(true);
    expect(isOverloaded({ status: 529 })).toBe(true);
    expect(isOverloaded({ status: 500 })).toBe(false);
    expect(isOverloaded(new Error('x'))).toBe(false);
    expect(isOverloaded(null)).toBe(false);
  });
});
