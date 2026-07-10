import {
  index,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, timestamps, ulidRef } from './_helpers';
import { WORKSPACE_ROLES } from './enums';

/**
 * Auth primitives (WO-003). Not part of the §3 canonical list; introduced here
 * for passwordless magic-link login and sessions. Only token *hashes* are
 * stored — raw tokens live solely in the email link / cookie.
 */

export const authTokens = mysqlTable(
  'auth_tokens',
  {
    id: idColumn(),
    email: varchar('email', { length: 320 }).notNull(),
    // sha256 hex of the raw magic-link token.
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash),
    index('auth_tokens_email_idx').on(t.email),
  ],
);

export const sessions = mysqlTable(
  'sessions',
  {
    id: idColumn(),
    userId: ulidRef('user_id').notNull(),
    // sha256 hex of the raw session token stored in the httpOnly cookie.
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    // The workspace the session is currently acting within.
    activeWorkspaceId: ulidRef('active_workspace_id'),
    expiresAt: timestamp('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('sessions_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const workspaceInvites = mysqlTable(
  'workspace_invites',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    role: mysqlEnum('role', WORKSPACE_ROLES).notNull().default('member'),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    invitedByUserId: ulidRef('invited_by_user_id'),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('workspace_invites_hash_uq').on(t.tokenHash),
    index('workspace_invites_ws_idx').on(t.workspaceId),
    index('workspace_invites_email_idx').on(t.email),
  ],
);
