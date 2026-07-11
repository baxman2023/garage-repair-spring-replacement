# CopyForge — Work Log

Running log of work orders. One entry per WO: files touched, decisions, open questions.

---

## Phase 0 — Foundation

### WO-001 — Repo scaffold

**Acceptance (restated):** pnpm monorepo with the locked stack — `apps/{web,worker,cli}`
and `packages/{db,core,ai}`; Next.js 15 App Router in TypeScript strict; tRPC wired
end-to-end; zod-validated env module; a PM2 `ecosystem.config.cjs` that runs web + worker;
root scripts `dev/build/typecheck/lint/produce/worker`. `pnpm typecheck` and `pnpm build`
green from a clean install; PM2 starts both processes locally.

**Status:** ✅ Complete. `pnpm typecheck`, `pnpm build`, and `pnpm lint` all green;
PM2 starts `copyforge-web` and `copyforge-worker` (both `online`, 0 restarts, stable
uptime) via `ecosystem.config.cjs`.

**Files touched:**
- Root: `package.json` (workspaces, scripts, `pnpm.onlyBuiltDependencies`),
  `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`,
  `.npmrc`, `.env.example`, `ecosystem.config.cjs`, `SPEC.md` (spec copied to root).
- `packages/core`: `env.ts` (zod env, lazy-validated), `id.ts` (ULID), `index.ts`.
- `packages/ai`: `index.ts` (Stage + CacheBlockRole vocab; full client is WO-006).
- `packages/db`: `client.ts` (lazy mysql2 pool + Drizzle client), `index.ts`.
- `apps/web`: Next 15 App Router — `layout.tsx`, `page.tsx`, `HealthCheck.tsx`,
  `globals.css`, tRPC server (`server/trpc.ts`, `server/routers/_app.ts`),
  fetch route (`app/api/trpc/[trpc]/route.ts`), client (`trpc/react.tsx`,
  `trpc/Provider.tsx`), `next.config.mjs`, `tsconfig.json`, `next-env.d.ts`.
- `apps/worker`: `src/index.ts` (env-validated boot, signal handlers, keep-alive).
- `apps/cli`: `src/index.ts` (`produce` arg-parser + help; phases land WO-016/34/49).

**Decisions:**
- **Monorepo tooling.** pnpm workspaces + `tsup` for library/app bundling + Next for
  web. Chose `tsup` (esbuild) over per-package `tsc` emit to avoid dist-ordering pain.
- **Package resolution.** Each workspace package exposes `exports` with
  `types → ./src/index.ts` and `import → ./dist/index.js`. TypeScript resolves types
  from source (so `typecheck` needs no prior build), while runtime/bundlers consume
  built `dist`. `pnpm -r build` runs in topological order, so packages build before apps.
- **`src/env.ts` placement.** Spec §1 names `src/env.ts` in a single-app mental model.
  In this monorepo it lives in `packages/core/src/env.ts` and is shared by all three
  apps so they validate identical env. Validation is *lazy* (Proxy, memoized) so
  `next build` never crashes on absent secrets; `assertEnv()` is called at worker/cli
  boot to fail fast.
- **PM2 worker in dev.** Fork mode can't exec the `tsx` shell shim, so dev mode
  (`WORKER_DEV=1`) runs `node --import tsx src/index.ts`; prod runs the compiled bundle.
- **Worker keep-alive.** A pending promise + signal listeners do not keep Node's event
  loop alive, so the boot installs a ref'd 30s interval (replaced by the real job-claim
  loop in WO-007).
- **Legacy static site.** The pre-existing garage-door HTML/PDF site is unrelated to
  CopyForge; left in place and excluded from ESLint.

**Open questions:** none blocking. (`.env` loading for local dev currently relies on the
shell/PM2 env; a dotenv/`--env-file` convention can be settled when WO-003 needs live
email/DB config.)

### WO-002 — Schema v1 + migrations

**Acceptance (restated):** Every §3 table modeled in Drizzle across per-domain files;
ULID `char(26)` ids, `created_at`/`updated_at` on all tables, composite indexes leading
with `workspace_id`; an idempotent seed for `model_routes`, `prompt_versions`,
`feature_flags`. `drizzle-kit` migration applies cleanly to a fresh MariaDB; seed re-runs
without duplicating.

**Status:** ✅ Complete. Verified against a live MariaDB 11: dropped + recreated the
database, `db:migrate` applied `0000_*.sql` cleanly (43 domain tables + drizzle tracker),
`db:seed` ran twice (run 1: model_routes +10, feature_flags +4; run 2: all +0). DDL
confirmed: `id char(26)`, `created_at DEFAULT current_timestamp`,
`updated_at ... ON UPDATE current_timestamp`, and composite indexes leading with
`workspace_id` (e.g. `assets_ws_project_idx`, `assets_ws_market_idx`).

**Files touched:**
- `packages/db/src/schema/`: `_helpers.ts` (idColumn/ulidRef/timestamps factories),
  `enums.ts` (shared enum tuples + TS unions), `identity.ts`, `strategy.ts`, `genome.ts`,
  `assets.ts` (+ `AssetBlock` type), `delivery.ts`, `ledger.ts`, `infra.ts`, `index.ts`.
- `packages/db/src/`: `client.ts` (bind typed `schema`), `index.ts` (export schema),
  `migrate.ts`, `seed.ts`, `loadEnv.ts`.
- `packages/db/drizzle.config.ts`, generated `drizzle/0000_*.sql` + meta.
- `packages/db/package.json` (db:generate/migrate/seed/push scripts; dotenv, tsx deps).
- `packages/core/package.json`: dual ESM+CJS build so tooling (drizzle-kit, CJS) can load
  it.

**Decisions:**
- **Every tenant table carries `workspace_id` (NOT NULL)** with a `(workspace_id, …)`
  composite index, per §2.2 — no exceptions among project/asset/ledger/quiz tables.
- **Shared vs tenant layers via NULLable `workspace_id`.** Genome tables
  (`swipes`/`genome_components`/`genome_packs`), `model_routes`, and `calibration_state`
  use a NULLable `workspace_id`: NULL = shared seed / platform default, non-NULL =
  workspace-private (internal-winner layer per WO-048, per-workspace model override per
  §1.3). Config tables `prompt_versions`/`feature_flags` are global.
- **Event dedupe is tenant-scoped:** unique `(workspace_id, dedupe_key)` rather than a bare
  global `dedupe_key`, to keep replay-safety within tenant boundaries (§4 says "dedupe_key
  unique"; scoped to workspace is the tenant-safe reading).
- **drizzle-kit loads a compiled CJS schema bundle** (`dist/schema/index.cjs`), not TS
  source: under a `type: module` package drizzle-kit's loader injects `require` into ESM
  scope and fails. `pnpm build` therefore precedes `db:generate`. The db build emits both
  ESM (app consumption) and CJS (tooling).
- **`users.is_platform_admin`** boolean added now as part of the identity model (drives the
  separate admin auth guard in WO-052) rather than a later migration.
- **Model IDs seeded from §1.1 as editable config** (haiku→classification/voc/claims/scrub,
  sonnet→drafting, fable→council/focus/autopsy/offer/market; fallback chain
  fable-5→opus-4-8→sonnet-4-6). Never hardcoded at call sites.
- **`prompt_versions` seed is an empty catalog by design at WO-002.** The seeder mechanism
  ships now; generation prompts are authored by their owning WOs (Council WO-020,
  generators WO-022+) and appended to `PROMPT_SEEDS` — avoids stub prompt bodies and
  scope-jumping.

**Open questions:** none blocking. JSON columns are typed loosely (`Record<string,unknown>`
/ light interfaces) for now; the full zod contracts in `packages/core/contracts` (§4) are
authored by the WOs that first produce each document (WO-009 product_profile, WO-013
market_profile, etc.), then wired onto the column `$type`s.

### WO-003 — Auth (magic link) + workspaces

**Acceptance (restated):** Passwordless magic-link login (token table, 15-min expiry,
single-use), httpOnly session cookies, workspace create-on-first-login, owner/member roles,
invite→accept flow. Full login → workspace → invite → accept path works; sessions survive
restart; expired/reused tokens rejected.

**Status:** ✅ Complete. `pnpm typecheck/build/lint` green; **10/10 vitest tests pass**
against live MariaDB, including the full login→workspace→invite→accept path, session
survival across a `closePool()` "restart", and expired + reused token rejection.

**Files touched:**
- `packages/db/src/schema/auth.ts` (auth_tokens, sessions, workspace_invites) + schema
  index; migration `drizzle/0001_daily_paladin.sql`.
- `apps/web/src/server/auth/`: `tokens.ts` (crypto/expiry, pure), `cookies.ts`
  (session cookie opts, cookie parse, `safeNextPath`), `email.ts` (nodemailer + dev-log
  fallback), `service.ts` (requestMagicLink/verify/sessions/invites), `session.ts`
  (`currentSession()` for server components), `tokens.test.ts`, `service.test.ts`.
- `apps/web/src/server/trpc.ts` (session context + `protectedProcedure`),
  `routers/auth.ts`, `routers/workspace.ts`, `routers/_app.ts`.
- Route handlers: `app/auth/verify/route.ts`, `app/invite/accept/route.ts`,
  `app/api/auth/logout/route.ts`.
- UI: `app/login/{page,LoginForm}.tsx`, `app/page.tsx` (dashboard),
  `app/InviteForm.tsx`.
- `apps/web/{vitest.config.ts,vitest.setup.ts}`, package.json (nodemailer, drizzle-orm,
  vitest, dotenv, @types/nodemailer; `test` script); root `test` script.

**Decisions:**
- **Only token hashes are persisted** (sha256 of a 32-byte random token). Raw tokens live
  solely in the emailed link / cookie. Session cookie is `cf_session`, httpOnly, SameSite
  lax, `secure` in production.
- **Single-use is enforced atomically** via a conditional `UPDATE … SET consumed_at WHERE
  consumed_at IS NULL AND expires_at > now` and an `affectedRows === 1` check — race-safe
  against double-consume. Invites use the same pattern on `accepted_at`.
- **Cookie mutation happens in Route Handlers** (`/auth/verify`, `/invite/accept`,
  `/api/auth/logout`), not tRPC mutations, since the fetch adapter can't set cookies mid-
  call. tRPC carries the resolved session in context for reads/guards.
- **`activeWorkspaceId` lives on the session** so a user in multiple workspaces has a
  current one; accepting an invite switches the session into that workspace.
- **Sessions are DB-backed**, so they survive process restarts (verified by dropping the
  pool mid-test and re-resolving).
- **Open-redirect guard** (`safeNextPath`) on the post-login `next` param.
- **Email has a dev/test fallback** that logs the link to stdout when `EMAIL_HOST` is
  unset — keeps CI/tests token- and SMTP-free.
- **`protectedProcedure` added; workspace/owner checks are inline in the workspace router
  for now.** The formal `withWorkspace` tenancy guard + `ownerProcedure` land in WO-004 and
  will absorb these inline checks.

**Open questions:** none blocking.

### WO-004 — Tenancy guard

**Acceptance (restated):** `withWorkspace` tRPC middleware injecting `workspace_id`;
`packages/db` query helpers that require workspace scope; a CI check forbidding raw tenant-
table queries outside the guard; a cross-tenant test suite that fails closed on every
tenant table.

**Status:** ✅ Complete. `pnpm typecheck/build/lint` green; tenancy scan clean (and verified
to fail closed on a planted violation); **31/31 db tests pass** — 29 per-table cross-tenant
isolation cases (read + update + delete all fail closed for a foreign workspace) plus 2
structural coverage checks; full suite 41 tests green.

**Files touched:**
- `packages/db/src/guard.ts` — `tenantDb(workspaceId)` (findMany/findFirst/insert/update/
  delete, all AND-in `workspace_id`; insert auto-stamps id + workspace), `TENANT_TABLES`,
  `TENANT_TABLE_NAMES`; exported from `index.ts`.
- `packages/db/src/guard.test.ts`, `vitest.config.ts`, `vitest.setup.ts`, package.json
  (vitest + `test`).
- `scripts/tenancy-scan.mjs` + root `check:tenancy` script.
- `apps/web/src/server/trpc.ts` — `workspaceProcedure` (`withWorkspace`) injecting
  `workspaceId`/`role`/scoped `db`, and `ownerProcedure`; `routers/workspace.ts` refactored
  onto them.
- `eslint.config.mjs` — Node globals for `.mjs` scripts.

**Decisions:**
- **Enforced set = 29 tenant business/commerce tables** (strategy, assets, delivery,
  ledger, plus api_keys/subscriptions/seat_assignments/licenses). Bootstrap/identity/infra
  tables (users, workspaces, workspace_members, sessions, auth_tokens, jobs, model_routes,
  audit_log, genome_*, calibration_state) are deliberately exempt — they're read while
  *establishing* the workspace context, span workspaces (fair scheduler), or are global
  config.
- **CI scan is precise, not a blunt grep:** a file only violates if it *imports* a tenant
  table from `@copyforge/db` AND calls `.from/.insert/.update/.delete` on it directly.
  Passing a table to `tenantDb().findMany(table, …)` or referencing `table.column` is
  allowed, so guard-mediated usage never trips it. Verified it flags a planted
  `getDb().select().from(assets)` and is otherwise clean.
- **`TENANT_TABLE_NAMES` is duplicated in the scan script** (node .mjs can't import the TS
  guard without a build); a comment ties them together. The db-side `guard.test.ts` asserts
  `entries` covers exactly `TENANT_TABLES`, catching drift on the DB side.

**Open questions:** none blocking.

### WO-005 — BYO Anthropic key vault

**Acceptance (restated):** AES-256-GCM encrypt/decrypt under `MASTER_KEY`, storing only
ciphertext+iv+tag+last4; a "test key" 1-token Messages ping; key rotation; redaction so keys
never appear in logs/errors. Keys round-trip; logs key-free under a forced error; a
workspace without a valid key gets an actionable error on any AI call.

**Status:** ✅ Complete. `pnpm typecheck/build/lint` green, tenancy scan clean, **55 tests
pass** (ai +14). Verified: AES-GCM round-trip + fresh IV + tamper-detection; the raw
`api_keys` row contains no plaintext (only ciphertext/iv/tag/last4); rotation resets
`verified_at`; `requireWorkspaceKey` throws an actionable `WorkspaceKeyError` when unset;
a failed ping's error is redacted (no `sk-ant`); `installConsoleRedaction` scrubs console
output.

**Files touched:**
- `packages/ai/src/`: `vault.ts` (crypto, store/get/rotate/delete, `requireWorkspaceKey`,
  `testWorkspaceKey` + `defaultAnthropicPing`), `redact.ts`, `errors.ts`, `index.ts`;
  `vault.test.ts`, `redact.test.ts`, `vitest.{config,setup}.ts`; package.json
  (@anthropic-ai/sdk, @copyforge/db, drizzle-orm, vitest, dotenv, @types/node).
- `apps/web/src/server/routers/apiKey.ts` (+ mounted in `_app.ts`);
  `app/settings/api-key/{page,ApiKeyPanel}.tsx`; `instrumentation.ts` (redaction on boot);
  dashboard link.
- `apps/worker/src/index.ts` — `installConsoleRedaction()` at boot.

**Decisions:**
- **MASTER_KEY decoding is flexible:** 64-hex → 32 bytes; else a 32-byte base64; else
  sha256-derived. AES-256-GCM with a random 12-byte IV per encryption; GCM tag stored
  separately, so tampering fails decryption.
- **The vault lives in `packages/ai`** (the "resolve workspace key" concern per WO-006) and
  accesses `api_keys` via `getDb()` directly — it is the canonical, always-workspace-scoped
  access point for that table (the CI scan covers app code, not this infra module). It's the
  one sanctioned reader/writer of `api_keys`.
- **`testWorkspaceKey` takes an injectable `Pinger`** (default = real 1-token Anthropic
  Messages call, model resolved from `model_routes.classification`, never hardcoded). Tests
  inject fakes so CI spends no tokens and needs no network — consistent with the mock-AI
  harness formalized in WO-006. It returns `{ok:false, error}` (redacted) rather than
  throwing, so the UI can show a clean failure.
- **Redaction is defense-in-depth:** `redact()` scrubs `sk-(ant-)?…` from strings/errors/
  objects, and `installConsoleRedaction()` (wired into Next `instrumentation.ts` and the
  worker boot) wraps console methods so even third-party log lines are scrubbed.
- **Only owners manage keys** (`ownerProcedure`); status is readable by any member.

**Open questions:** none blocking. The live Anthropic ping path is real but unexercised
against the API here (no real key / egress); it's covered structurally + via injected
pingers, and will run for real once a workspace key + the WO-006 client exist.
