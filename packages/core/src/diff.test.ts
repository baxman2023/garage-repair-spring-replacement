import { describe, expect, it } from 'vitest';
import { lineDiff } from './diff.js';

describe('lineDiff', () => {
  it('marks all lines equal for identical text', () => {
    const ops = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(ops.every((o) => o.type === 'equal')).toBe(true);
    expect(ops.map((o) => o.text)).toEqual(['a', 'b', 'c']);
  });

  it('detects a changed middle line as remove + add', () => {
    const ops = lineDiff('a\nb\nc', 'a\nx\nc');
    expect(ops).toContainEqual({ type: 'remove', text: 'b' });
    expect(ops).toContainEqual({ type: 'add', text: 'x' });
    expect(ops.filter((o) => o.type === 'equal').map((o) => o.text)).toEqual(['a', 'c']);
  });

  it('detects pure additions and removals', () => {
    expect(lineDiff('a', 'a\nb')).toContainEqual({ type: 'add', text: 'b' });
    expect(lineDiff('a\nb', 'a')).toContainEqual({ type: 'remove', text: 'b' });
  });
});
