/**
 * Bounded retry for transactions that can hit InnoDB deadlocks or lose a
 * version race on a unique key. Version allocation reads MAX(version) without
 * FOR UPDATE (locking an empty range takes gap locks that deadlock concurrent
 * inserts); the unique `( … , version)` index converts races into ER_DUP_ENTRY,
 * which we retry.
 */

const RETRYABLE = /ER_LOCK_DEADLOCK|Deadlock found|ER_DUP_ENTRY|Duplicate entry/i;

export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE.test(message)) throw err;
      await new Promise((r) => setTimeout(r, 25 * (i + 1)));
    }
  }
  throw lastError;
}
