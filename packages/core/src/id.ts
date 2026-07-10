import { ulid } from 'ulidx';

/**
 * Canonical id generator (spec §3): ULID as a 26-char string.
 * Lexicographically sortable, time-prefixed. Stored in `char(26)` columns.
 */
export function newId(): string {
  return ulid();
}

/** A CopyForge entity id — a 26-character ULID. */
export type Id = string;
