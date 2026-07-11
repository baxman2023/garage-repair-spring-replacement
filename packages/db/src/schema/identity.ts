import {
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { idColumn, json, timestamps, ulidRef } from './_helpers';
import { API_PROVIDERS, LICENSE_STATUSES, LICENSE_TYPES, WORKSPACE_ROLES } from './enums';

/** Identity & commerce (spec §3). */

export const users = mysqlTable(
  'users',
  {
    id: idColumn(),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 255 }),
    // scrypt hash for password login (nullable: magic-link-era accounts).
    passwordHash: varchar('password_hash', { length: 255 }),
    // Platform-owner flag drives the separate admin auth guard (WO-052).
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const workspaces = mysqlTable('workspaces', {
  id: idColumn(),
  name: varchar('name', { length: 255 }).notNull(),
  ownerUserId: ulidRef('owner_user_id').notNull(),
  ...timestamps(),
});

export const workspaceMembers = mysqlTable(
  'workspace_members',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    userId: ulidRef('user_id').notNull(),
    role: mysqlEnum('role', WORKSPACE_ROLES).notNull().default('member'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('workspace_members_ws_user_uq').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

export const licenses = mysqlTable(
  'licenses',
  {
    id: idColumn(),
    // NULLABLE (WO-050): a freshly issued key is unbound; activation binds it
    // to the activating workspace. Tenant reads never see unbound rows.
    workspaceId: ulidRef('workspace_id'),
    key: varchar('key', { length: 64 }).notNull(),
    status: mysqlEnum('status', LICENSE_STATUSES).notNull().default('active'),
    type: mysqlEnum('type', LICENSE_TYPES).notNull().default('standard'),
    seats: int('seats').notNull().default(1),
    expiresAt: timestamp('expires_at'),
    // Stripe linkage (WO-051): lets a refund find its license.
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('licenses_key_uq').on(t.key),
    index('licenses_workspace_idx').on(t.workspaceId),
  ],
);

export const seatAssignments = mysqlTable(
  'seat_assignments',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    licenseId: ulidRef('license_id').notNull(),
    userId: ulidRef('user_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('seat_assignments_license_user_uq').on(t.licenseId, t.userId),
    index('seat_assignments_ws_idx').on(t.workspaceId),
  ],
);

export const subscriptions = mysqlTable(
  'subscriptions',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    // Genome Feed entitlement (spec §5 commercial model / WO-051).
    genomeFeed: boolean('genome_feed').notNull().default(false),
    status: varchar('status', { length: 32 }).notNull().default('inactive'),
    currentPeriodEnd: timestamp('current_period_end'),
    ...timestamps(),
  },
  (t) => [index('subscriptions_ws_idx').on(t.workspaceId)],
);

/** Receipts/invoices surfaced in-app (WO-051). Tenant-scoped. */
export const billingReceipts = mysqlTable(
  'billing_receipts',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    kind: mysqlEnum('kind', ['license', 'subscription', 'refund'] as const).notNull(),
    stripeRef: varchar('stripe_ref', { length: 255 }).notNull(),
    amountCents: int('amount_cents').notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('usd'),
    description: varchar('description', { length: 512 }).notNull(),
    // Stripe-hosted receipt/invoice URL, when the event carried one.
    url: varchar('url', { length: 1024 }),
    ...timestamps(),
  },
  (t) => [index('billing_receipts_ws_idx').on(t.workspaceId)],
);

export const stripeEvents = mysqlTable(
  'stripe_events',
  {
    id: idColumn(),
    // Stripe's event id; unique for idempotent webhook processing (WO-051).
    stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull(),
    type: varchar('type', { length: 128 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('stripe_events_event_uq').on(t.stripeEventId)],
);

export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    provider: mysqlEnum('provider', API_PROVIDERS).notNull().default('anthropic'),
    // AES-256-GCM material only — never the plaintext key (WO-005).
    ciphertext: text('ciphertext').notNull(),
    iv: varchar('iv', { length: 64 }).notNull(),
    tag: varchar('tag', { length: 64 }).notNull(),
    last4: varchar('last4', { length: 8 }),
    verifiedAt: timestamp('verified_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('api_keys_ws_provider_uq').on(t.workspaceId, t.provider)],
);

export const usageLedger = mysqlTable(
  'usage_ledger',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id').notNull(),
    projectId: ulidRef('project_id'),
    jobId: ulidRef('job_id'),
    stage: varchar('stage', { length: 64 }),
    model: varchar('model', { length: 128 }).notNull(),
    inputTokens: int('input_tokens').notNull().default(0),
    cacheReadTokens: int('cache_read_tokens').notNull().default(0),
    outputTokens: int('output_tokens').notNull().default(0),
    costEstUsd: decimal('cost_est_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    ...timestamps(),
  },
  (t) => [
    index('usage_ledger_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('usage_ledger_ws_project_idx').on(t.workspaceId, t.projectId),
  ],
);

export const auditLog = mysqlTable(
  'audit_log',
  {
    id: idColumn(),
    workspaceId: ulidRef('workspace_id'),
    actorUserId: ulidRef('actor_user_id'),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 64 }),
    targetId: varchar('target_id', { length: 26 }),
    meta: json('meta').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [index('audit_log_ws_created_idx').on(t.workspaceId, t.createdAt)],
);
