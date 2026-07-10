import { char, timestamp } from 'drizzle-orm/mysql-core';
import { newId } from '@copyforge/core';

/**
 * Shared column helpers (spec §3 conventions):
 * - `id` = ULID `char(26)`, generated app-side.
 * - `created_at` / `updated_at` on every table.
 *
 * These are factory functions (not shared column instances) because Drizzle
 * requires a fresh column builder per table.
 */

/** Primary key: 26-char ULID, generated in application code. */
export const idColumn = () =>
  char('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => newId());

/** A ULID foreign-key / reference column (nullable unless `.notNull()` added). */
export const ulidRef = (name: string) => char(name, { length: 26 });

/** `created_at` + `updated_at` timestamps, spread into every table definition. */
export const timestamps = () => ({
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});
