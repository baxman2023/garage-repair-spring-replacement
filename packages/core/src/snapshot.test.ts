import { describe, expect, it } from 'vitest';
import { canonicalStringify, snapshotHash } from './snapshot.js';

describe('snapshot hashing (WO-015)', () => {
  it('is invariant to key order', () => {
    const a = { x: 1, y: [{ b: 2, a: 1 }], z: 'q' };
    const b = { z: 'q', y: [{ a: 1, b: 2 }], x: 1 };
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('changes on any value change', () => {
    const base = { markets: [{ label: 'A', rank: 1 }] };
    expect(snapshotHash(base)).not.toBe(snapshotHash({ markets: [{ label: 'A', rank: 2 }] }));
    expect(snapshotHash(base)).not.toBe(snapshotHash({ markets: [{ label: 'B', rank: 1 }] }));
  });

  it('array order matters (ranks are ordered)', () => {
    expect(snapshotHash([1, 2])).not.toBe(snapshotHash([2, 1]));
  });

  it('ignores undefined-valued keys', () => {
    expect(snapshotHash({ a: 1, b: undefined })).toBe(snapshotHash({ a: 1 }));
  });
});
