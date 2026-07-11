import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition } from './assetStatus.js';
import { diffBlocks, mergeRegeneratedBlocks, type AssetBlock } from './blocks.js';

describe('asset status machine (WO-021)', () => {
  it('allows the canonical pipeline path', () => {
    const path = ['draft', 'council', 'revising', 'council', 'focus_group', 'deslop', 'compliance', 'packaging', 'approved', 'live', 'retired'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('live', 'approved')).toBe(false);
    expect(canTransition('retired', 'live')).toBe(false);
    expect(canTransition('council', 'council')).toBe(false);
    expect(() => assertTransition('draft', 'live')).toThrow(/Illegal/);
  });

  it('blocked is a trap without override; override resumes into the flow', () => {
    expect(canTransition('blocked', 'council')).toBe(false);
    expect(canTransition('blocked', 'council', { override: true })).toBe(true);
    expect(canTransition('blocked', 'approved', { override: true })).toBe(true);
    expect(canTransition('blocked', 'live', { override: true })).toBe(false); // never straight to live
    expect(canTransition('blocked', 'retired', { override: true })).toBe(false);
  });

  it('any gate stage can fail into blocked', () => {
    for (const from of ['draft', 'council', 'revising', 'focus_group', 'deslop', 'compliance', 'packaging'] as const) {
      expect(canTransition(from, 'blocked')).toBe(true);
    }
  });
});

const block = (id: string, text: string, locked = false): AssetBlock => ({
  id,
  role: 'body',
  text,
  meta: locked ? { locked: true } : {},
});

describe('lock-honoring regeneration merge (WO-021)', () => {
  it('locked blocks keep their content; unlocked take the regeneration', () => {
    const current = [block('a', 'original A', true), block('b', 'original B')];
    const regen = [block('a', 'regen A tried to change this'), block('b', 'regen B')];
    const merged = mergeRegeneratedBlocks(current, regen);
    expect(merged.find((b) => b.id === 'a')!.text).toBe('original A'); // lock honored
    expect(merged.find((b) => b.id === 'b')!.text).toBe('regen B');
  });

  it('locked blocks survive even when the regeneration drops them', () => {
    const current = [block('a', 'keep me', true), block('b', 'replace me')];
    const regen = [block('b', 'new B'), block('c', 'brand new')];
    const merged = mergeRegeneratedBlocks(current, regen);
    expect(merged.map((b) => b.id)).toEqual(['a', 'b', 'c']); // re-inserted at original index
    expect(merged[0]!.text).toBe('keep me');
  });

  it('unlocked blocks dropped by regeneration stay dropped', () => {
    const current = [block('a', 'A'), block('b', 'B')];
    const regen = [block('a', 'A2')];
    expect(mergeRegeneratedBlocks(current, regen).map((b) => b.id)).toEqual(['a']);
  });
});

describe('block diff (WO-021)', () => {
  it('renders adds, removes, edits, and reorders', () => {
    const a = [block('h', 'Headline one'), block('l', 'lead line\nsecond line'), block('x', 'gone')];
    const b = [block('l', 'lead line\nrewritten line'), block('h', 'Headline one'), block('n', 'new block')];
    const diff = diffBlocks(a, b);
    expect(diff.added.map((x) => x.id)).toEqual(['n']);
    expect(diff.removed.map((x) => x.id)).toEqual(['x']);
    expect(diff.changed.map((x) => x.id)).toEqual(['l']);
    expect(diff.changed[0]!.ops).toContainEqual({ type: 'remove', text: 'second line' });
    expect(diff.changed[0]!.ops).toContainEqual({ type: 'add', text: 'rewritten line' });
    expect(diff.unchanged).toEqual(['h']);
    expect(diff.reordered).toBe(true);
  });

  it('identical versions diff empty', () => {
    const a = [block('h', 'same')];
    const diff = diffBlocks(a, a);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.reordered).toBe(false);
  });
});
