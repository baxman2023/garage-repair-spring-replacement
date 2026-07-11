/**
 * Minimal LCS-based line diff (WO-008 prompt version diff view). Pure and
 * dependency-free.
 */

export type DiffOpType = 'equal' | 'add' | 'remove';
export interface DiffOp {
  type: DiffOpType;
  text: string;
}

/** Diff two texts line-by-line into an ordered list of equal/add/remove ops. */
export function lineDiff(aText: string, bText: string): DiffOp[] {
  const a = aText.split('\n');
  const b = bText.split('\n');
  const m = a.length;
  const n = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'remove', text: a[i]! });
      i++;
    } else {
      ops.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < m) ops.push({ type: 'remove', text: a[i++]! });
  while (j < n) ops.push({ type: 'add', text: b[j++]! });
  return ops;
}
