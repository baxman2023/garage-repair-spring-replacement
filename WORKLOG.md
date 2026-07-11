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

### WO-006 — AI client wrapper + model router + usage metering

**Acceptance (restated):** `packages/ai` is the single choke point — resolves the workspace
key + model route, applies the fallback chain on 429/529 with exponential backoff + jitter,
builds `cache_control` block stacks (§1.2), records a `usage_ledger` row per call with a
cost estimate, enforces per-stage timeout/max_tokens. Mocked-API unit tests cover routing/
fallback/metering; no Anthropic request is built outside `packages/ai`.

**Status:** ✅ Complete. `pnpm typecheck/build/lint` green, both CI scans clean (and each
verified to fail closed on a planted violation), **65 tests pass** (ai 23). Coverage:
workspace-override routing + max_tokens, fallover model-A→model-B after 3×529 with injected
backoff, ledger row with exact token counts + cost, cache blocks forwarded, actionable
no-key error (transport never reached), redacted non-retryable error.

**Files touched:**
- `packages/ai/src/`: `stages.ts` (moved STAGES/cache roles out to break cycle),
  `transport.ts` (Transport interface, default SDK transport, `toSystemParam`,
  `isOverloaded`), `client.ts` (`createClient`/`generate`, route resolution, fallback loop,
  metering), `mock.ts` (`MockTransport`), `pricing.ts`; tests
  `transport.test.ts`, `client.test.ts`; `index.ts` exports.
- `scripts/ai-boundary-scan.mjs` + root `check:ai-boundary`.
- **`packages/db/src/schema/_helpers.ts`** — custom `json` column type (parse-on-read) +
  swapped into all 7 schema files; `packages/db/src/json.test.ts` regression test.

**Decisions:**
- **MariaDB JSON bug fixed globally.** drizzle 0.38's `MySqlJson` has no read mapper, and
  MariaDB returns JSON as LONGTEXT (a string), so every JSON column was round-tripping as an
  unparsed string (surfaced as a corrupted `fallback_chain` spread char-by-char). Replaced
  `json()` with a `customType` that `JSON.parse`s on read across the schema. No DDL/migration
  change (still `json` type). Locked with a round-trip regression test.
- **Transport is injectable; the mock harness (`MockTransport`) ships now** (spec §8) so CI
  never spends tokens. `createClient({ transport, sleep, jitter })` makes backoff/fallback
  deterministic in tests.
- **Fallback loop:** up to 3 attempts per model on 429/529 (exponential backoff
  `500ms·2^attempt·(1+jitter)`), then advance through the deduped `[primary, ...fallback]`
  chain. Non-retryable errors are redacted and surfaced immediately.
- **Metering** reads `input/output/cache_read` tokens from the response and writes a
  `usage_ledger` row with a cost estimate from the editable `PRICING` table (unknown models
  → `DEFAULT_PRICE`, so cost is always recorded). `cache_read` vs `input` are tracked
  separately so cache-hit rate is observable per §1.2.
- **AI boundary enforced by CI:** `@anthropic-ai/sdk` may only appear in `packages/ai`;
  the scan flags `new Anthropic(` / SDK imports anywhere else.

**Open questions:** none blocking. `PRICING` values are directional estimates (documented as
such); real per-model prices can be corrected in the admin surface (WO-052).

---

## Phase 0 progress checkpoint

WO-001 … WO-006 complete, committed, and pushed. Remaining in Phase 0: WO-007 (job queue +
fair scheduler), WO-008 (prompt registry + pinning). Running totals: 65 tests, live MariaDB
bootstrapped in-container, two CI guard scans (tenancy, ai-boundary).

### WO-007 — Job queue + fair scheduler

**Acceptance (restated):** Atomic claim via `FOR UPDATE SKIP LOCKED`; round-robin fairness
(least-recently-served workspace first); heartbeat + stale-claim reaper; retries with backoff
→ `failed` with error JSON; `job_runs` audit; graceful shutdown; env-tunable concurrency.
Fairness: A's 100 jobs don't starve B's 2; a crash mid-job is reclaimed exactly once.

**Status:** ✅ Complete. `pnpm typecheck/build/lint` green, scans clean, **74 tests pass**
(db +6 queue, worker +3). Verified: B's 2 jobs served within the first scheduling window
against A's 100; no job claimed twice under concurrent drain; retry→backoff→failed after max
attempts with error JSON + two `job_runs`; crashed (stale-heartbeat) job reaped once and
completed by another worker; heartbeat only refreshes for the owning worker; worker loop
dispatches to handlers, fails on throw / missing handler, and stops gracefully.

**Files touched:**
- `packages/db/src/queue.ts` (enqueue/claim/heartbeat/complete/fail/reap + `retryDelayMs`),
  exported from `index.ts`; `queue.test.ts`.
- `packages/db/src/schema/infra.ts` — `heartbeat_at` → `timestamp(fsp:3)`; migration
  `0002_*.sql`.
- `apps/worker/src/worker.ts` (runtime loop, handler registry, reaper, graceful stop),
  `index.ts` (wire loop + signal handlers), `worker.test.ts`, vitest config/setup, deps.

**Decisions (WO-007):**
- **MariaDB `SKIP LOCKED` semantics.** MariaDB applies `LIMIT` *before* `SKIP LOCKED`
  removes locked rows, so `LIMIT 1 … FOR UPDATE SKIP LOCKED` returns empty (not the next
  row) when its single candidate is locked, and a batch `FOR UPDATE` locks the whole batch.
  Confirmed with a two-connection probe. The spec mandates `FOR UPDATE SKIP LOCKED`, so the
  claim keeps it and the **worker polls** — a transient empty under contention just means
  "retry shortly," never a lost job. Tests model this by draining across polling rounds; the
  worker-loop test proves exactly-once processing under concurrency 2.
- **Fairness via `MAX(heartbeat_at)` per workspace**, NULL (never served) first. Needed
  millisecond precision (`fsp:3`) — second-resolution timestamps tied constantly and
  collapsed fairness to FIFO (which starved B). Now round-robins correctly.
- **Retry/backoff:** exponential `1s·2^(attempts-1)` capped at 5 min; re-queues with a future
  `run_after` until `max_attempts`, then `failed` with the error stored as JSON. Every
  attempt writes a `job_runs` row (`running`→`succeeded`/`retrying`/`failed`/`reaped`).
- **Graceful shutdown:** `stop()` flips a flag, clears the reaper interval, and awaits all
  in-flight loop iterations; the entrypoint wires SIGINT/SIGTERM → drain → `closePool` →
  exit.
- **Handlers registered by type** in the worker entrypoint (empty now; generators/gates
  register theirs in later WOs). Unknown type → immediate `failJob` with an actionable
  message.

**Open questions:** none blocking.

### WO-008 — Prompt registry + pinning

**Acceptance (restated):** `prompt_versions` CRUD (admin-only), a `getPrompt(name)` loader
for the active version, `asset_versions.prompt_version_id` recorded at generation, regen
honoring the pinned version unless "upgrade to latest", and a version diff view. Bumping a
prompt must not change regeneration of an existing asset unless explicitly upgraded.

**Status:** ✅ Complete. `pnpm typecheck/build/lint` green, scans clean, **78 tests pass**
(core +3 diff, db +1 prompts). The pinning test proves the acceptance directly: an asset
pinned to v1 resolves v1's body even after v2 becomes active; `upgradeToLatest` (or no pin)
resolves the active version; re-activating v1 flips the pointer with history intact.

**Files touched:**
- `packages/core/src/diff.ts` (LCS `lineDiff`) + `diff.test.ts`, vitest config, exports.
- `packages/db/src/prompts.ts` (getPrompt/getPromptById/list/create/activate/
  `resolvePromptForGeneration`) + `prompts.test.ts`; exported from `index.ts`.
- `apps/web/src/server/trpc.ts` (`adminProcedure`), `routers/prompts.ts` (+ mounted),
  `app/admin/prompts/{page,PromptsAdmin}.tsx`.

**Decisions:**
- **Prompts are immutable + versioned:** "editing" creates the next version; `createPromptVersion`
  auto-increments and (by default) activates it, deactivating siblings in one transaction.
- **Pinning is the load-bearing guarantee (§10 risk 5):** `asset_versions.prompt_version_id`
  (already in the schema) records the version used; `resolvePromptForGeneration(name, {pinnedId,
  upgradeToLatest})` returns the pinned version unless upgrade is requested or no pin exists.
  Generators (WO-021+) call this and stamp the id.
- **CRUD is `adminProcedure`-gated** (platform admin via `users.is_platform_admin`), distinct
  from workspace owner/member roles — the seed of the WO-052 admin panel.
- **Diff** is a pure core LCS line diff, rendered in the admin UI (add/remove/equal).

**Open questions:** none blocking.

---

## PHASE 0 REPORT — Foundation (WO-001 … WO-008) ✅ COMPLETE

**State:** All eight foundation WOs implemented, verified, committed, and pushed to
`claude/copyforge-saas-build-3z1g9t`. Green across the board:
`pnpm typecheck`, `pnpm build`, `pnpm lint`, **78 tests** (core 3, db 39, ai 23, web 10,
worker 3), plus two CI guard scans (tenancy, ai-boundary) — each verified to fail closed on a
planted violation. Migrations `0000`–`0002` apply cleanly to a fresh MariaDB; seed is
idempotent.

**What exists now:**
- Monorepo (Next 15 / tRPC / Drizzle / MariaDB / PM2), zod env, dual-format packages.
- Full §3 schema (43 tables + auth) with the tenancy guard (`tenantDb`) + CI enforcement.
- Passwordless auth, workspaces, invites, sessions.
- Encrypted BYO key vault + redaction; the AI client (routing, 429/529 fallback, cache
  blocks, usage metering) with the mocked-AI harness; fair job queue + worker loop; prompt
  registry + pinning.

**Risks / notes:**
1. **Environment:** MariaDB is bootstrapped in-container via apt (no managed DB; Docker
   registry blocked by the proxy). It's re-provisioned per session and won't persist across
   container reclaim — fine for CI-style verification, but not a durable datastore.
2. **Live Anthropic path unexercised:** no real key/egress here, so the real transport +
   test-key ping are covered structurally + via mocks only. First real call happens once a
   workspace key is present (Phase 1+).
3. **`PRICING` values are directional estimates** (documented as such); correctable in admin
   (WO-052).
4. **JSON-column fix** (custom parse-on-read `json` type) was a necessary correction to a
   drizzle+MariaDB gap — locked with a regression test; worth remembering it underpins every
   JSON contract.

**Deviations proposed:** none. Everything tracked the spec; the schema/design calls
(nullable `workspace_id` on shared layers, tenant-scoped event dedupe, `is_platform_admin`,
`FOR UPDATE SKIP LOCKED` + polling given MariaDB's LIMIT/SKIP-LOCKED semantics) are recorded
above with rationale.

**Awaiting your go before starting Phase 1 (Intake & Strategy, WO-009 … WO-016).**

> Go received — Phase 1 started.

---

## Phase 1 — Intake & Strategy

### WO-009 — Sales Detective intake

**Acceptance (restated):** Emit contract-valid `product_profile.json` via Dump mode (paste
text / URL fetched by a worker job with readability extraction / txt-md upload) and
Interrogation mode (adaptive flow over origin story, mechanism, proof, enemy, price, prior
attempts, compliance mode, voice samples — asking only unanswered fields); profile editor
UI; versioned saves.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **96 tests pass**
(core 17, worker 7 incl. 4 intake). Verified: dump paste → contract-valid v1 profile with
the seeded prompt as a cached system block; URL mode fetches via injectable fetcher,
readability-extracts (script/style stripped), records the source URL in `links`; a second
dump merges without clobbering (v2); a non-contract model response rejects with nothing
saved; interrogation asks only unanswered fields (incl. the compliance-default subtlety);
invalid choice/number answers rejected.

**Files touched:**
- `packages/core`: `contracts/productProfile.ts` (zod contract §4, `emptyProductProfile`,
  `mergeProductProfiles`, `applyIntakeAnswer`, `unansweredProfileFields`,
  `INTAKE_QUESTIONS`) + tests; `readability.ts` (HTML→text) + `jsonExtract.ts` (balanced
  `{…}` parser) + tests; `jobs.ts` (shared job-type vocabulary).
- `packages/db`: `profiles.ts` (versioned profile store: `getCurrentProfile`,
  `saveProfileVersion` — transactional version bump + `is_current` flip +
  `projects.current_profile_id`); seed: `intake.extract_profile` prompt v1.
- `apps/worker`: `handlers/intake.ts` (one job type for paste+URL dumps: fetch →
  readability → pinned prompt → haiku-stage extraction → contract parse → merge → new
  version), registered in `index.ts`; `handlers/intake.test.ts`.
- `apps/web`: routers `projects.ts` + `intake.ts` (profile/dumpText/dumpUrl/questions/
  answer/saveProfile); UI `/projects` list + `/projects/[id]` IntakeWorkbench (dump
  textarea, URL, file→text upload, one-question-at-a-time interrogation with skip,
  JSON profile editor with versioned save).

**Decisions:**
- **Both dump variants run through one worker job** (`intake.extract_profile`); paste is
  enqueued too, so all AI work happens in the worker (consistent with the later fan-out) and
  the UI polls the profile.
- **File upload** is read client-side (`File.text()`) and submitted through the paste path —
  txt/md need no server-side parsing.
- **Extraction stage = `classification`** (haiku per §1.1 — cheap/high-volume extraction);
  prompt body forbids invented facts; extraction merges (non-empty wins, arrays union) so
  repeated dumps enrich rather than overwrite; user edits survive because empty incoming
  values never clobber.
- **`compliance_mode` interrogation subtlety:** its contract default `'none'` is also a
  legitimate answer, so value alone can't mark it answered. `unansweredProfileFields` takes
  the interview's explicitly-answered set (client-held); every other field retires on data
  presence alone.
- **Two toolchain fixes along the way:**
  (1) `Omit<InferInsertModel<T>>` in a generic position defers and then drops optional
  properties from excess-property checks (TS rejects valid insert fields). Replaced with a
  key-remapped mapped type `TenantInsert<T>` — resolves correctly; negative case
  (`workspaceId` supplied) still rejects.
  (2) The tenancy scan matched guard-mediated calls (`ctx.db.insert(projects, …)`).
  Tightened to the raw-drizzle no-comma form (`.insert(tbl).values`-style); verified still
  fails closed on planted raw queries.

**Open questions:** none blocking.

### WO-010 — Offer Forge (G0)

**Acceptance (restated):** fable-5 pass producing diagnosis + 3 strengthened variants
(quantified value stack, risk reversal, legitimate urgency, price framing, name candidates);
side-by-side picker; selected offer versioned to `offers`; G0 recorded. Cannot advance
without an approved offer meeting the G0 checklist; fake scarcity structurally excluded.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **111 tests pass**
(core +7 offer/G0, db +5 offer store, worker +3 forge). Verified: forge persists exactly 3
unapproved variants with the seeded prompt cached and the profile as the user block; forge
output containing fake scarcity is rejected at contract-parse with nothing persisted; G0
fail leaves no approved offer (advance blocked) and writes a failing project-level gate
report; pass approves + sets `projects.current_offer_id`; G0 refused on a non-selected
offer; store is workspace-scoped end to end.

**Files touched:**
- `packages/core/src/contracts/offer.ts` (+ test): offer contract with `URGENCY_TYPES` enum
  + fabricated-scarcity text refinement, `offerForgeResultSchema` (exactly 3 variants), pure
  `checkG0` checklist.
- `packages/db`: `offers.ts` store (variants/select/edit/`recordG0`/`getApprovedOffer`) +
  test; `txRetry.ts`; schema: `gate_reports.asset_id` now nullable + `project_id` column +
  index (migration `0003`); seed: `offer.forge` prompt v1.
- `apps/worker`: `handlers/offerForge.ts` (+ test), registered.
- `apps/web`: `routers/offers.ts` (list w/ per-offer G0 preview, forge, select, saveEdit,
  approve, status), `/projects/[id]/offer` page + `OfferForgePanel` (side-by-side cards,
  checklist ticks, select/edit/approve).

**Decisions:**
- **Fake scarcity is excluded at three layers:** the prompt's urgency menu lists only the
  six legitimate types and forbids invention; the contract's `type` enum can't express
  anything else; a text refinement rejects fabricated-scarcity language (`fake`, `evergreen
  countdown`, `artificial`, …) in descriptions/legitimacy fields. Contract-invalid forge
  output persists nothing.
- **G0 verdicts are recorded even when failing** (auditable gate history), as project-level
  `gate_reports` rows (`asset_id` NULL). Schema needed `gate_reports.project_id` since
  G0–G2 are project-scoped — flagged as the spec's §3 lists only `asset_id`; this is an
  additive change in the same spirit as the §5 gate table.
- **Approval path:** UI can only approve the *selected* offer; the router recomputes
  `checkG0` server-side (never trusts the client), records the verdict, and only a pass
  marks `approved` + project pointer. `getApprovedOffer` is the advancement key WO-011 will
  require.
- **Deadlock fix:** `FOR UPDATE` on empty version ranges (profiles/offers) took InnoDB gap
  locks that deadlocked concurrent first-inserts (surfaced as test flake). Removed the row
  locks; the unique `(project_id, version)` indexes turn races into duplicates, retried by
  a small bounded `withTxRetry` helper.

**Open questions:** none blocking.

### WO-011 — Funnel Math (G1)

**Acceptance (restated):** Inputs (price, margin, refund est., channel CPCs, benchmark CVR
table in config) → outputs (allowable CPA, breakeven ROAS, projected CPA per channel,
required LTV); pass/fail; HARD STOP with a ranked fix list routing back to G0; printable
report. Math unit-tested incl. edge cases; a failing project cannot enqueue generation jobs.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **120 tests pass**
(core +6 math, db +3 store/hard-stop). Verified: full metric derivations; hard stop with
ranked (ascending-effort) quantified fixes against the best channel; benchmark CVR fallback
by channel name → default; boundary (CPA == allowable) passes; invalid inputs rejected;
`enqueueGenerationJob` refuses with no run and after a failing run, flows after a pass, and
a later failing run re-arms the stop; both verdicts land as project-level G1 gate reports.

**Files touched:**
- `packages/core/src/funnelMath.ts` (+ test): zod inputs, `BENCHMARK_CVRS` config defaults,
  `computeFunnelMath` → net revenue/sale, allowable CPA, breakeven ROAS, per-channel
  projected CPA + required LTV, ranked `fixes`.
- `packages/db/src/funnelMath.ts` (+ test): `recordFunnelMathRun` (run + G1 gate report,
  transactional), `latestFunnelMathRun`, `assertG1Passed`, **`enqueueGenerationJob`** — the
  single enqueue path for generation-class jobs, enforcing the hard stop.
- `apps/web`: `routers/funnelMath.ts` (run — requires approved G0 offer; latest),
  `/projects/[id]/math` page + `FunnelMathPanel` (inputs form, report tables, fix list,
  print stylesheet + Print button). Offer page links onward.

**Decisions:**
- **Benchmark CVR table lives in core config** (`BENCHMARK_CVRS`, documented as directional
  defaults, overridable per run via each channel's explicit CVR). Admin-editable storage can
  layer on in WO-052 without changing the math.
- **Hard-stop enforcement is structural:** generation-class enqueues must go through
  `enqueueGenerationJob(projectId, …)`, which throws before touching the queue unless the
  *latest* run passed. WO-012+ (market selection, fan-out) use it; intake/offer-forge are
  pre-G1 by design.
- **DAG order enforced:** `funnelMath.run` refuses without an approved offer (G0 first);
  fail verdicts are recorded (never hidden) and the report renders either way.
- **Fix list is quantified against the best channel** (smallest gap): price ×, CVR ×, CPC ÷,
  AOV target, margin (marked impossible when >100% needed), refund call-out — sorted by
  required-change factor so the easiest lever leads.

**Open questions:** none blocking.

### WO-012 — Market Selection Engine

**Acceptance (restated):** fable-5 candidate generation (8–12); starving-crowd scoring
matrix (pain, purchasing power, reachability, urgency, LTV — weights in config); ranked
list UI with swap/edit/add-manual; top 5 persisted to `markets` rank 1–5. Scores persisted
with rationale per market; user edits survive re-runs.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **131 tests pass**
(core +4, db +4, worker +3). Verified: deterministic weighted ranking persists exactly the
top 5 at ranks 1–5 with scores + rationale; a user-edited market keeps its rank/label
through a full engine re-run while the other four slots refresh; swap exchanges ranks;
manual add fills a free rank → displaces the worst engine row when full → refuses when all
five are user-defined; out-of-contract candidate counts persist nothing; handler requires
G0 first; the run endpoint enqueues via `enqueueGenerationJob`, so the G1 hard stop
applies (matching the DAG: G1 → market selection).

**Files touched:**
- `packages/core/src/contracts/market.ts` (+ test): `STARVING_CROWD_WEIGHTS` (config,
  sum=1), candidate/result contracts (8–12, scores 0–10), `scoreMarket` (0–100),
  `rankCandidates` (stable ties).
- `packages/db/src/markets.ts` (+ test): `applyEngineCandidates` (engine rows replaced,
  user rows survive at their ranks, label-dedupe vs user rows), `swapMarketRanks`,
  `updateMarket` (marks user-origin), `addManualMarket`; seed: `market.select` prompt v1.
- `apps/worker/src/handlers/marketSelect.ts` (+ test), registered.
- `apps/web`: `routers/markets.ts` (list/run/swap/update/addManual), `/projects/[id]/markets`
  page + `MarketsPanel` (ranked cards, ↑↓ swap, inline edit, manual add).

**Decisions:**
- **Edit-survival mechanism:** rows carry `origin: 'engine' | 'user'` inside their profile
  JSON. Any edit or manual add flips to `user`; re-runs replace only engine rows and skip
  candidates whose label collides with a kept user row. No schema change needed.
- **Ranked-candidate slate is capped at 5 slots**; manual adds beyond 5 displace the worst
  engine row and refuse when the user owns all five (explicit, not silent).
- **Weights live in core config** (`STARVING_CROWD_WEIGHTS`, admin-editable later);
  0–10 dimension scores × weights → 0–100 total, persisted to `markets.score_total`.

**Open questions:** none blocking.

### WO-013 — Market profiles (Schwartz diagnosis)

**Acceptance (restated):** Full `market_profile.json` per selected market — awareness stage
+ sophistication with one-line justifications, resident emotion, avatar, ≥5 objections,
entry_conversation, channels ranked — plus a profile editor. 5 contract-valid profiles;
diagnosis fields non-empty and referenced later by generators (assert in G3 prompt inputs).

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **138 tests pass**
(core +4, worker +3). Verified: all 5 markets get contract-valid profiles with rank/label/
scores **pinned from the stored row** (the model's echo is ignored) and diagnosis mirrored
into the `awareness_stage`/`sophistication`/`resident_emotion` columns; the user-origin
marker survives profiling; an incomplete diagnosis (4 objections) persists nothing;
`marketProfilePromptBlock` — the §1.2 market cache-block builder generators/Council will
consume — carries every diagnosis field and **throws on an undiagnosed market** (the G3
prompt-input assertion point).

**Files touched:**
- `packages/core/src/contracts/marketProfile.ts` (+ test): strict §4 contract (+
  `awareness_justification` / `sophistication_justification` per the WO deliverable),
  `marketProfilePromptBlock`.
- `packages/db`: `markets.applyMarketProfile` (merge preserving `origin`, mirror columns);
  seed `market.profile` prompt v1.
- `apps/worker/src/handlers/marketProfile.ts` (+ test), registered. One job per market.
- `apps/web`: markets router `profileAll` (per-market generation jobs via
  `enqueueGenerationJob` → G1 applies) + `updateProfile` (contract-validated editor save,
  marks user-origin) + `diagnosed` flag in list; MarketsPanel: "Diagnose all" button,
  diagnosis status line, per-market profile JSON editor.

**Decisions:**
- **Justification fields are additive to the §4 contract** (`awareness_justification`,
  `sophistication_justification`) — the WO deliverable explicitly requires one-line
  justifications; recorded as a contract extension, not a deviation.
- **Identity pinning:** rank/label/starving-crowd scores always come from the stored market
  row, never from model output — profiles can't drift from the approved slate.
- **The generator-side assertion** the acceptance asks for is implemented as the only path
  to a market cache block: `marketProfilePromptBlock` parses strictly first, so WO-020/022+
  physically cannot build prompts from undiagnosed markets.

**Open questions:** none blocking.

### WO-014 — VOC miner

**Acceptance (restated):** Source intake (paste blobs, URLs); haiku extraction →
`voc_phrases` typed pain|desire|objection|identity with source refs; dedupe; per-market
corpus viewer; corpus injected into generation cache blocks. 200-phrase corpus < 2 min on
worker; phrases traceable to sources; generators demonstrably quote VOC (spot-check
harness).

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **147 tests pass**
(core +5, worker +4). Verified: paste source → typed phrases each carrying
`source_ref = sourceId` (traceable); URL source fetched + readability-extracted with
content persisted to the source row; dedupe within batch and across successive mines
(normalized text); 200-phrase corpus inserted in one job, measured well under the 2-minute
budget; `vocQuoteRate` spot-check harness detects verbatim quotes in generated copy and
returns 0 for generic text.

**Files touched:**
- `packages/core/src/contracts/voc.ts` (+ test): extraction contract (typed phrases),
  `normalizePhrase`/`dedupePhrases`, `vocCorpusPromptBlock` (§1.2 cache-block renderer,
  grouped by kind, per-kind cap), `vocQuoteRate` harness.
- `packages/db/src/voc.ts`: sources CRUD + `insertMarketPhrases` (dedupe against existing
  corpus); seed `voc.extract` prompt v1.
- `apps/worker/src/handlers/vocMine.ts` (+ test), registered; chunks long sources (24k
  chars) with the prompt cached across chunk calls; haiku `voc_extraction` stage.
- `apps/web`: `routers/voc.ts` (addSource → enqueue mine via `enqueueGenerationJob`;
  corpus), `/projects/[id]/voc` page + `VocPanel` (market tabs, paste/URL intake, corpus
  viewer grouped by kind with counts + source tooltips).

**Decisions:**
- **"No usable VOC" sentinel:** the prompt instructs a specific sentinel instead of invented
  quotes; the handler filters it out, so junk sources yield zero phrases rather than
  fabricated voice.
- **Dedupe key** = casefolded, punctuation-stripped, whitespace-collapsed phrase text —
  catches typographic variants without fuzzy-matching false positives.
- **VOC mining is treated as generation-class spend** (goes through the G1 hard-stop
  enqueue path).
- The **spot-check harness lives in core** so generator tests (WO-022+) can assert quote
  rates against the corpus without new plumbing.

**Open questions:** none blocking.
