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

### WO-015 — Strategy Review (G2)

**Acceptance (restated):** Side-by-side 5-market review screen (scores, diagnosis, VOC
highlights); approve/regenerate per market; G2 record with snapshot hash. Fan-out
unreachable until G2 approved; approval snapshot immutable.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **155 tests pass**
(core +4 snapshot hashing, db +4 G2). Verified: `assertG2Approved` throws before approval
and passes after; snapshot refuses non-5-market or undiagnosed slates; post-approval edits
(profile re-diagnosis OR row-level label rename) flip status to **stale** and re-lock the
fan-out; the stored snapshot's hash and content are untouched by later edits and by
re-approval (old G2 report rows immutable, re-approval appends a new one).

**Files touched:**
- `packages/core/src/snapshot.ts` (+ test): `canonicalStringify` (key-order-invariant) +
  `snapshotHash` (sha256).
- `packages/db/src/strategyGate.ts` (+ test): `buildStrategySnapshot` (5 contract-valid
  profiles or throw), `recordG2` (immutable report with hash+markets, sets project status
  to `build`), `getG2Status` (approved/stale via hash comparison), `assertG2Approved` —
  the fan-out lock WO-028 will call.
- `packages/db/src/markets.ts`: `updateMarket` now syncs label edits into the profile JSON
  so row-level renames move the snapshot hash (found via the G2 tests).
- `apps/web`: `routers/strategy.ts` (review payload with per-market diagnosis + VOC
  highlights; regenerateMarket; approve), `/projects/[id]/review` page + `ReviewPanel`
  (5-up grid, G2 status banner incl. stale warning, approve button gated on full diagnosis).

**Decisions:**
- **Staleness semantics:** G2 approval is valid only while the *current* markets hash-match
  the approved snapshot. Any market change re-locks the build until re-approval — the
  strong reading of "approval snapshot immutable" + "fan-out unreachable until approved."
- **Immutability by construction:** gate reports are insert-only; the snapshot (hash + full
  profiles) is embedded in the report row, so later market edits cannot rewrite what was
  approved. Verified in tests.

**Open questions:** none blocking.

### WO-016 — produce CLI v1

**Acceptance (restated):** `npm run produce -- --project <id> --phase strategy
[--auto-approve]` runs WO-009-input → WO-013 outputs where possible, JSON summary to
stdout, non-zero exit on gate failure; CI-runnable against a seeded fixture project.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **158 tests pass**
(pipeline 17 relocated, cli +3). Verified: a seeded fixture project runs the FULL phase
headlessly with mocked AI (`--dump-file` intake → forge → auto-G0 → G1 → selection → 5
diagnoses → auto-G2) ending with `assertG2Approved` actually unlocked; a G1 hard stop
returns `ok:false` with the ranked fix list in the summary; without `--auto-approve` the
run stops `pending` at the human G0 checkpoint. The built binary prints help, `--version`,
and exits 2 on bad args / 1 on gate failure / 0 on success.

**Files touched:**
- **New `packages/pipeline`** — the five job handlers (intake, offerForge, marketSelect,
  marketProfile, vocMine) + their 17 tests moved here from `apps/worker/src/handlers` so
  the worker (queue-driven) and CLI (inline) share one implementation. Worker imports from
  `@copyforge/pipeline`; behavior unchanged.
- `apps/cli/src/strategy.ts` — `runStrategyPhase(opts, deps)`: resolve project→workspace,
  optional dump-file intake, forge + auto-G0 (first checklist-passing variant), funnel math
  (flags: `--price/--margin/--refund/--cpc`), market selection, per-market diagnosis, G2
  under `--auto-approve`; structured `StrategySummary`.
- `apps/cli/src/index.ts` — arg parsing, help, JSON to stdout, exit codes; loads root .env.
- `apps/cli/src/strategy.test.ts` — the CI fixture runs (mocked AI, zero tokens).
- `packages/db/profiles.ts` — `resolveProjectById` bootstrap lookup (the CLI's tenancy
  entry point; keeps the tenancy scan clean rather than raw-querying in the app).

**Decisions:**
- **Handlers moved to a shared package** rather than duplicating logic or having the CLI
  spawn a worker. `apps/worker` remains the queue driver; `apps/cli` drives the same
  handlers inline — one implementation, two drivers (recorded as a §2 structure addition).
- **`--auto-approve` covers G0 and G2** (picks the first G0-passing variant; snapshots +
  records G2). Without it the CLI stops at each human gate with `pending` status — G2 is a
  human checkpoint by design.
- **dotenv externalized** in the CLI build (CJS `require` inside the ESM bundle broke the
  binary — caught by smoke-testing `dist/index.js`).

**Open questions:** none blocking.

---

## PHASE 1 REPORT — Intake & Strategy (WO-009 … WO-016) ✅ COMPLETE

**State:** All eight WOs implemented, verified, committed, pushed. Green:
`pnpm typecheck` / `build` / `lint`, **158 tests** (core 47, db 55, ai 23, pipeline 17,
web 10, worker 3, cli 3), tenancy + ai-boundary scans clean. Migrations 0000–0003; seeds
idempotent (10 model routes, 4 flags, 5 prompts).

**The strategy pipeline now runs end-to-end** (headless-verified in CI with mocked AI):
dump/URL/interrogation intake → versioned product profile → Offer Forge (3 variants,
fake-scarcity structurally impossible) → G0 checklist approval → Funnel Math with hard stop
+ ranked fixes → market selection (starving-crowd matrix, user edits survive re-runs) →
Schwartz diagnosis per market (strict contract; generators can't build prompts from
undiagnosed markets) → VOC mining (typed, deduped, source-traceable, quote-rate harness) →
G2 snapshot approval (staleness-aware) → `assertG2Approved` ready to lock/unlock the Phase 2
fan-out.

**Risks / notes:**
1. Same environment caveats as Phase 0 (in-container MariaDB; live Anthropic path unexercised
   — all AI verified through the mock harness).
2. **Structure addition:** `packages/pipeline` (shared handlers) — spec §2 lists only
   db/core/ai; this addition is the minimal way to satisfy WO-016's headless requirement
   without duplicating generator logic. Flagged for approval as a deviation-in-spirit.
3. **Contract extensions** (documented per-WO): `awareness/sophistication_justification` in
   market_profile (WO-013 deliverable), `gate_reports.project_id` for project-level gates.
4. G2 staleness semantics (edits re-lock the build) is the strong reading of "approval
   snapshot immutable" — flag if you want approvals to survive market edits instead.

**Awaiting your go before starting Phase 2 (Genome & Generation, WO-017 … WO-028).**

> Go received — Phase 2 started.

---

## Phase 2 — Genome & Generation

### WO-017 — Persuasion Genome: schema + decomposer

**Acceptance (restated):** Swipe intake (paste/URL); sonnet decomposition into
`genome_components` (lead, mechanism_name, proof_stack, price_reveal, close, bullet_style,
headline_pattern) with confidence + tags (niche, channel, awareness). 10-swipe fixture
decomposes with ≥90% components typed; components queryable by type+niche.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **165 tests pass**
(core +4, pipeline +3). Verified: the 10-swipe fixture (with deliberate untyped strays)
stays ≥90% typed and yields components queryable by type+niche (10 leads for the niche;
full count matches; confidence persisted); a decomposition below the 90% bar fails loudly
with nothing persisted; workspace privacy holds (an intruder can neither decompose nor see
another workspace's swipe).

**Files touched:**
- `packages/core/src/contracts/genome.ts` (+ test): tolerant `parseGenomeDecomposition`
  (keeps valid typed components, counts dropped, reports typedRatio).
- `packages/ai/src/stages.ts`: new `genome_decompose` stage; seeded model route → sonnet
  (§1.1 "sonnet decomposition").
- `packages/db/src/genome.ts`: two-layer store (NULL workspace = shared seed; non-NULL =
  private), `addSwipe`/`getSwipe`/`updateSwipeSource`/`listSwipes`/`insertGenomeComponents`/
  `queryGenomeComponents`; seed `genome.decompose` prompt v1.
- `packages/pipeline/src/genomeDecompose.ts` (+ test), registered in the worker; URL swipes
  stored as `URL:<href>` and fetched+readability-extracted by the job before decomposition;
  `MIN_TYPED_RATIO = 0.9` enforced per decomposition.
- `apps/web`: `routers/genome.ts` (addSwipe paste/URL → auto-decompose job; swipes;
  components query), `/genome` page + `GenomePanel` (intake + type/niche-filtered browser).

**Decisions:**
- **The ≥90% typed acceptance is a runtime quality bar**, not just a fixture stat: any
  single decomposition below 90% typed throws (job retries/fails visibly) rather than
  silently persisting a thin read of the swipe.
- **Components inherit the swipe's layer** (shared vs workspace) — the WO-048 leak rule is
  enforced from day one; queries always scope `(shared OR own)`.
- **Swipe niche/channel take precedence over the model's inference** when both exist.

**Open questions:** none blocking.

### WO-018 — Genome retrieval + seed corpus

**Acceptance (restated):** `genome_packs` curated per niche; retrieval fn (type/niche/
awareness/channel filters, recency-weighted); rendered as a §1.2 cached block; seed loader
for `/seed/genome`. Retrieval deterministic given seed; cache block within token budget
with graceful truncation by weight.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **172 tests pass**
(core +4, db +3). Verified: seed loader is idempotent (2nd run +0/+0); two retrievals over
the same seed return identical ordering; weight = confidence × 2^(−age/half-life) with an
id-asc tiebreak (input order never matters); the cache block adds best-weight-first and
truncates the lowest-weight components at the budget (token estimate enforced, same inputs
→ byte-identical block); layer isolation holds (another workspace's private components are
invisible); packs resolve by curated ids or filters.

**Files touched:**
- `packages/core/src/genomeBlock.ts` (+ test): `componentWeight` (90-day half-life config),
  `rankComponents`, `estimateTokens` (chars/4), `genomePromptBlock` (4000-token default
  budget, graceful truncation, reports included/truncated ids).
- `packages/db/src/genome.ts`: `retrieveGenome` (injectable `now` for determinism),
  `createGenomePack`/`listGenomePacks`/`resolveGenomePack`; `seedGenome.ts` loader
  (`pnpm db:seed-genome`, stable ids from niche+key, shared layer) + `genome.test.ts`.
- `/seed/genome/direct-response-classics.json` — 4 owner-corpus swipes / 8 components
  (WSJ two-young-men, Caples they-laughed, Schwartz mechanism naming, Kennedy stack-then-
  price) as the real starter corpus.

**Decisions:**
- **Determinism is explicit:** retrieval and rendering take `now` as a parameter; ties
  break on id. Tests pin `now` and assert byte-identical output.
- **Budget truncation is by weight, not order-of-arrival** — the block always keeps the
  strongest DNA and reports what it dropped (no silent truncation, §10 risk 6 spirit).
- **Pack definitions support both curated ids and filter-based membership** (both §3's
  "curated retrieval sets" reading and practical dynamic packs).

**Open questions:** none blocking.

### WO-019 — Meta Ad Library harvester (manual-trigger v1)

**Acceptance (restated):** Per-niche saved queries; worker fetch of Ad Library results;
filter to ads running ≥90 days; store to `swipes` (first_seen/last_seen/days_running) →
auto-decompose via WO-017; ToS-respecting rate limits; degrade to a guided manual-paste
flow with the same downstream path when blocked. Genome Feed entitlement gates scheduled
runs; nothing scheduled without entitlement.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **176 tests pass**
(db +1 guard entry, pipeline +3). Verified: a run over a mixed-age fixture keeps only
≥90-day ads (200d + boundary-90d kept, 30d filtered), stores them with first/last-seen +
days_running + `adlib:<id>` tags, and enqueues a `genome.decompose` job per swipe; a
blocked fetch records `status:"degraded"` with paste guidance and the job succeeds
cleanly; scheduling refuses with the platform flag off, refuses with the flag on but no
entitlement, and enqueues once an active Genome-Feed subscription exists; manual triggers
work without any entitlement.

**Files touched:**
- Schema: `harvest_queries` (workspace-scoped; niche + query JSON + last_run/last_result;
  migration `0004`), added to the tenancy guard + scan + cross-tenant suite.
- `packages/db/src/harvest.ts`: query CRUD, `recordHarvestResult`, `triggerHarvest`
  (manual), `hasGenomeFeedEntitlement`, `scheduleHarvest` (flag + entitlement gate).
- `packages/pipeline/src/harvest.ts` (+ test), registered: injectable `AdLibraryFetcher`
  port; default uses the OFFICIAL `graph.facebook.com/ads_archive` API with
  `META_ADLIB_TOKEN`, paced 2s between pages (≤3 pages); `HarvestBlockedError` →
  degradation path.
- `apps/web`: genome router harvest endpoints; GenomePanel harvester section (save query,
  Harvest now, ok/degraded status display).

**Decisions:**
- **ToS honesty:** only the official Ad Library API is used — no scraping. No token / API
  refusal degrades to guided manual paste, which flows through the identical
  swipe→decompose path (spec §10 risk 1).
- **Degradation is a successful job outcome** (recorded, not thrown) — retries won't
  hammer a blocked API; the UI surfaces the guidance.
- **`harvest_queries` is an additive table** (not in §3's canonical list) — needed a home
  for per-niche saved queries + last-run results; guard-enforced like all tenant tables.
- Boundary rule: exactly 90 days running counts as in (≥).

**Open questions:** none blocking.

### WO-020 — Council engine (G3)

**Acceptance (restated):** Cached persona blocks + rubrics per §6; parallel fable-5 lens
calls; aggregation in pure `council.ts`; verdicts persisted to `council_reviews`; revision
prompt composed ONLY from failing lenses; loop max 3 then escalate with notes UI; per-asset
report view. Fixture bad-draft fails then improves across loops on record; thresholds
config-driven; aggregate math unit-tested.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **188 tests pass**
(core +9 aggregation, pipeline +3 engine). Verified: the corporate bad-draft fixture fails
round 1 (aggregate 67.5, halbert 55 / carlton 58 below floor), the revision improves it,
round 2 passes at 88 — with six `council_reviews` rows per version on record; the revision
prompt contained HALBERT + CARLTON notes and none of the passing lenses; both §1.2 cached
blocks (persona corpus + market profile) ride every lens call; three failing loops →
escalation notes recorded in a failing G3 gate report and the asset goes `blocked`; a
lenient config passes what defaults fail (thresholds config-driven). Aggregate math:
boundary 80/70 passes, one sub-70 lens fails a 95-aggregate, weights clamp to ±20% and
floors are immune to weighting.

**Files touched:**
- `packages/core/src/council.ts` (+ test): lens-result contract, `DEFAULT_COUNCIL_CONFIG`
  (80/70, weights 1.0), `clampWeights` (±20% band for WO-045), `aggregateCouncil`
  (weighted mean, floor rule, focused failing-lens selection), `composeRevisionNotes`.
- Seeds: `council.personas` v1 — all six persona+rubric definitions in ONE cached block
  (§1.2 block 1: shared across every council call) with a uniform JSON output contract —
  and `council.revise` v1.
- `packages/db/src/assetsStore.ts`: asset/version store seeded for the Council
  (createAsset, insertAssetVersion with word counts + pointer update,
  insertCouncilReviews, listCouncilReviewsForAsset, recordAssetGate, setAssetStatus —
  the enforced transition machine arrives in WO-021).
- `packages/pipeline/src/council.ts` (+ test): `createCouncilRunner` — 6 parallel lens
  calls (stage `council`), persist → aggregate → revise (failing lenses only, stage
  `asset_drafting`) → new version → loop ≤3 → escalate.
- `apps/web`: `routers/council.ts` (per-asset report: reviews grouped by version + latest
  G3 gate + escalation notes), `/assets/[assetId]/council` report view with lens grid and
  escalation panel.

**Decisions:**
- **Failing-lens selection is focused:** lenses that said `revise` or broke the floor;
  only when none did but the aggregate still fails does it fall back to sub-threshold
  lenses. Keeps the brief from sweeping in passing lenses' non-notes (surfaced by the
  fixture test).
- **Persona corpus is one prompt-registry entry** (versioned/pinnable per WO-008), not six
  — matching §1.2's "shared across all council calls" cache design; the dynamic block
  names the lens per call.
- On pass, the runner records G3 and leaves the asset in `council` status — the status
  machine that advances assets between gates is WO-021's contract.

**Open questions:** none blocking.

### WO-021 — Asset framework

**Acceptance (restated):** `assets`/`asset_versions` per §3–§4; status transitions enforced
in one module; block editor (edit/reorder/lock — locked blocks survive regeneration);
version diff view; regenerate-single-block. Illegal transitions rejected; block lock
honored across regen; diff renders adds/removes/edits.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **200 tests pass**
(core +9, pipeline +3). Verified: the canonical path
draft→council⇄revising→focus_group→deslop→compliance→packaging→approved→live→retired is
legal, jumps/regressions rejected, every gate stage can fail into `blocked`, `blocked` is a
trap without override, override resumes into any gate stage (never straight to live) and
writes an `audit_log` row with actor + reason; locked blocks keep content through a
regeneration merge and are re-inserted when regen drops them, while unlocked drops stick;
block diff renders adds/removes/edits(+line ops)/reorders; single-block regen creates a
version differing in exactly the target block and REFUSES locked blocks (transport never
reached).

**Files touched:**
- `packages/core`: `assetStatus.ts` (transition map + override rules), `blocks.ts`
  (`mergeRegeneratedBlocks`, `diffBlocks`), tests; `AssetBlockMeta.locked` added to the db
  schema type too.
- `packages/db/assetsStore.ts`: `transitionAssetStatus` (validates via core, audits
  overrides); `setAssetStatus` retained as a deprecated shim used by the council runner
  (its moves are all legal transitions).
- `packages/pipeline/regenBlock.ts` (+ test), registered as `asset.regen_block`.
- `apps/web`: `routers/assets.ts` (get, saveBlocks→user version, regenerateBlock with
  lock pre-check, diff, owner-only `override`), `/assets/[assetId]` editor (per-block
  edit/lock/reorder/regen, save-as-version, version picker + rendered diff).

**Decisions:**
- **Override semantics:** owner may resume a blocked asset into any gate stage up to
  `approved`, never directly to `live`/`retired` — going live requires passing through the
  approval machinery.
- **Lock is block-`meta.locked`** (§4 meta extension); enforcement lives in three layers:
  merge helper (regeneration), worker handler (refuses), router (pre-check + disabled UI).
- **Flake fix (council test):** parallel lens calls + FIFO mock mapped responses to lenses
  nondeterministically; replaced with a lens-aware transport that answers by request
  content. 5/5 stable runs after.

**Open questions:** none blocking.

### WO-022 — Generator: long-form sales letter

**Acceptance (restated):** Structure selector (PAS | star-story-solution | 4Ps); Bencivenga
bullet engine from VOC + proof; mechanism section using the profile's mechanism names;
offer/close from the approved offer; target lengths config; consumes market + genome cache
blocks. Contract-valid blocks; every claim registered to `claims`; enters G3 automatically.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **203 tests pass**
(pipeline +3). Verified: generation produces contract-valid blocks (roles from the §4
enum, unique ids) on an asset with the prompt version **pinned**; both extracted claims
registered (proof-matched → `proven`, naked → `flagged`); an `asset.council` job enqueued
for the new asset (auto-G3); the §1.2 stack rides as three cached system blocks (genome →
market+VOC → generator prompt) with offer/profile/structure in the dynamic block; the
structure selector defaults `pas` for a problem-aware market and honors an explicit `4ps`;
the letter demonstrably quotes VOC at rate 1.0 via the WO-014 harness; an undiagnosed
market refuses generation before any model call.

**Files touched:**
- `packages/core/src/contracts/assetBlocks.ts`: §4 block-role contract
  (`parseGeneratedBlocks`), claims-extraction contract, `TARGET_LENGTHS` config.
- `packages/db/assetsStore.ts`: `insertClaims` (auto proven/flagged by proof ref) +
  `listClaims`.
- `packages/pipeline/src/generators/context.ts`: `buildGenerationContext` — the shared
  §1.2 cache-block builder (genome retrieval → block; strict market profile block; VOC
  corpus block) all WO-023–027 generators will reuse.
- `packages/pipeline/src/generators/salesLetter.ts`: the generator (structure defaulting
  by awareness, prompt-pinned asset creation, claims registration, auto-council enqueue).
- `packages/pipeline/src/generate.ts` (`asset.generate` dispatcher — one job type, typed
  payload; generators register per WO) + `councilJob.ts` (`asset.council` — runs the
  WO-020 runner with a strictly-built market block); both registered in the worker.
- Seeds: `generate.sales_letter` v1 (structure beats, Bencivenga bullet rules, mechanism-
  name fidelity, offer mirroring, no-invention, readability + AI-tell guardrails) and
  `claims.extract` v1 (haiku claims inventory with proof-ref matching).

**Decisions:**
- **One `asset.generate` job type dispatching by `assetType`** keeps the worker registry
  and fan-out orchestration (WO-028) simple; each WO adds a generator function, not a new
  queue plumbing path.
- **G3 entry is a queued job**, not inline — matches the fan-out ordering/cache design and
  makes generation resumable (WO-028 kill/resume requirement).
- **Claims registration is part of generation** (same job): version saved → haiku
  extraction → claims rows; proof-matched claims start `proven`, naked ones `flagged` —
  feeding WO-031's inventory.

**Open questions:** none blocking.

### WO-023 — Generator: VSL script

**Acceptance (restated):** RMBC construction; THREE lead variants (story | big promise |
secret) as sibling versions; 170-WPM timestamps per block; retention map with open-loop
blocks planted before predicted drop-offs; promise verbalized inside 30s (asserted);
post-processor (digits→words, stage-direction strip, scrubYears) unit-tested; duration
calc within ±5% of wordcount/170.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **216 tests pass**
(core +8 spoken-script, pipeline +3 VSL). Verified: 3 sibling versions with distinct
`leadType` metas; stored text has `$349`→"three hundred forty-nine dollars",
`in 2023`→"a while back", `1,200`→words, `[PAUSE]` stripped, and **zero digits**;
timestamps sequential and total duration within ±5% of wordcount/170; open-loop blocks
flagged `meta.openLoop` and validated to sit at-or-before their predicted drop block
(violation → hard reject); a promise flagged after 30s rejects the whole generation; claims
extracted per variant; auto-G3 enqueued. Post-processor unit tests: integers to words up to
millions, $/%/decimals/comma-groups, cue-parenthetical vs content-parenthetical stripping,
year evergreening ("back in 2019"→"a while back", "since 2020"→"for years now").

**Files touched:**
- `packages/core/src/spokenScript.ts` (+ test): `integerToWords`/`numbersToWords`,
  `stripStageDirections` (brackets always; parentheticals only on performance-cue words),
  `scrubYears`, `applySpokenConventions` (**order matters:** strip → scrubYears →
  numbersToWords — years must be scrubbed before digit conversion eats them; caught by
  test), `timestampBlocks`/`totalDurationSeconds` at the 170-WPM basis.
- `packages/pipeline/src/generators/vsl.ts` (+ vsl.test): RMBC prompt-driven generation,
  strict variant contract (exactly 3, typed leads, ≥1 retention entries), per-variant
  post-processing + stamping, retention-map placement validation,
  `assertPromiseInFirst30Seconds` (model flags `meta.verbalizesPromise`; generator asserts
  timestampStart < 30), sibling-version persistence with retention map in version meta,
  claims per variant, auto-council. Registered as `assetType: 'vsl'` in the dispatcher.
- Seed: `generate.vsl` v1.

**Decisions:**
- **Promise assertion contract:** the model must flag the block that verbalizes the promise;
  the generator asserts it exists and lands < 30 s by 170-WPM math. Semantic promise-
  matching would be fuzzy; the flag + timing check is deterministic and testable.
- **Retention map is validated, not trusted:** unknown block ids or loops planted after
  their drop point reject the generation.

**Open questions:** none blocking.

### WO-024 — Generator: short-form feeder hooks

**Acceptance (restated):** 3 × ~30-second vertical scripts per market (pattern-interrupt
hook ≤3s, mechanism tease, curiosity CTA to the VSL), same spoken post-processor, linked to
the parent VSL variant. Each ≤90 words spoken; hook block flagged and first; CTA references
the VSL slug.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **219 tests pass**
(pipeline +3). Verified: 3 feeder assets created with `parent_asset_id` → the VSL; each
≤90 spoken words; the hook is the FIRST block with `timestampEnd ≤ 3.1s`; the CTA block
carries `meta.ctaTarget === <vsl slug>` (checked against the stored slug, which the prompt
supplies); spoken conventions + timestamps applied; each feeder auto-enters G3. Rejections:
>90 words, a 20-word (≈7s) hook, and a CTA pointing at the wrong slug.

**Files touched:**
- `packages/pipeline/src/generators/shortForm.ts` (+ test): contract (exactly 3 scripts),
  hook-first + ≤3s validation, ≤90-word cap, slug-reference validation, parent-VSL
  resolution (payload option or newest VSL for the market), auto-council per feeder.
- `packages/pipeline/src/generators/vsl.ts`: VSLs now get a `slug`
  (`vsl-<id-suffix>`) at creation — the deployable identity feeders and message-match
  (WO-041) reference.
- Dispatcher case `short_form_video`; seed `generate.short_form` v1.

**Decisions:**
- **The CTA slug reference is structural** (`meta.ctaTarget`), not textual — a spoken CTA
  shouldn't say "vsl-3f9a2b" out loud; the meta target is what the delivery layer wires,
  and validation is exact-match against the parent's slug.
- Hook budget = 3s at 170 WPM (≈8 words) with 0.1s rounding headroom.

**Open questions:** none blocking.

### WO-025 — Generator: webinar

**Acceptance (restated):** Perfect-Webinar-skeleton presentation — big domino statement,
three secrets breaking the vehicle/internal/external beliefs, stack & close built from the
approved offer — plus registration-page copy, reminder emails (24h/1h/15m), and the replay
email; presentation timestamped at 170 WPM. Skeleton sections must all be present and
ordered; the stack must mirror the offer's value stack line-for-line.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **223 tests pass**
(pipeline +6: 2 pure assertion suites + 4 DB-backed). Verified: all six sections
(`big_domino → secret_vehicle → secret_internal → secret_external → stack → close`)
present and ordered via `meta.section`; stack carries every value-stack item by name AND
its spoken dollar value (asserted post-conversion, so `$500` → "five hundred dollars" is
what's checked); registration blocks stored `section:"registration"` WITHOUT timestamps
(written copy); exactly 4 emails (subject+body block pairs, `email_<kind>` sections);
presentation timestamps sequential and within ±5% of wordcount/170; claims inventory
extracted; auto-G3 council enqueue. Rejections: misordered skeleton, stack missing an
offer item, missing email kind.

**Files touched:**
- `packages/pipeline/src/generators/webinar.ts` (+ `webinar.test.ts`): result contract,
  `assertSkeletonOrder`, `assertStackMirrorsOffer`, spoken conventions + timestamps on the
  presentation only, single asset with presentation/registration/email blocks in one
  version.
- Dispatcher case `webinar`; pipeline index exports; seed `generate.webinar` v1
  (skeleton order + section names + line-for-line stack rule are in the prompt AND
  enforced structurally after).

**Decisions:**
- **One asset, one version, sectioned blocks** — the webinar package (presentation +
  registration + emails) ships and gets council-reviewed as a unit; `meta.section`
  partitions it for delivery/export (WO-034 teleprompter TXT can filter to skeleton
  sections). Sibling-version fan-out stays a VSL-only concept (lead variants).
- **Stack mirror is asserted against SPOKEN values** (`integerToWords`) because the
  assertion runs after the spoken post-processor — dollars-as-digits can't appear in a
  spoken script.
- **Registration escapes the min-3-block contract**: `parseGeneratedBlocks` demands ≥3
  blocks (asset-level rule); a registration page is legitimately 2 (headline + bullets),
  so its blocks validate against `generatedBlockSchema` directly.
- Emails are stubs by design — full sequence engine is WO-026.

**Open questions:** none blocking.

### WO-026 — Generator: email sequences

**Acceptance (restated):** Owned-audience engine per market — indoctrination/welcome
(5–7), launch seed→open→close (9), cart abandon (3), 10 daily-infotainment templates in
founder voice; subject + preview + body blocks; merge-field conventions documented; every
email single-CTA. Sequence graphs persisted with send-offset metadata; subjects pass the
G5 AI-tell scrub.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **242 tests pass**
(core +15, pipeline +4). Verified: all four sequences persisted as `email_sequence`
assets; version meta carries `sequence.{kind, emails[{id, send_offset_hours, phase?}]}`
with strictly-increasing offsets; blocks are subject/preview/body triplets sectioned per
email with `sendOffsetHours` in meta; launch graph keeps seed→open→close phase tags (all
three acts required, order enforced); founder voice samples reach the daily-infotainment
prompt; each sequence auto-enters G3. Rejections: AI-tell subject, 0 or 2 `{{cta_link}}`,
undocumented merge field, wrong cardinality, non-increasing offsets, backwards phases.

**Files touched:**
- `packages/core/src/aiTells.ts`: the G5 AI-tell config list (`AI_TELLS`, wildcard-capable
  matcher `findAiTells`, `hasEmDashOveruse`) — shared config WO-030's De-Slop gate reuses.
- `packages/core/src/contracts/emailSequence.ts` (+ `emailSequence.test.ts`):
  `MERGE_FIELDS` conventions, token extraction/unknown detection, `SEQUENCE_SPECS`
  cardinalities, `validateEmailSequence` (counts, monotonic offsets, launch phases,
  single-CTA, merge-field fail-closed, subject scrub + first_name-only rule),
  `sequenceGraph`.
- `docs/merge-fields.md`: the documented merge-field conventions (deliverable).
- `packages/pipeline/src/generators/emailSequences.ts` (+ test): one AI call per kind,
  one asset per sequence, claims + auto-council per asset;
  `options.sequences` filter for fan-out (WO-028).
- Dispatcher case `email_sequence`; seed `generate.email_sequence` v1;
  `BLOCK_ROLES` + `preview`.

**Decisions:**
- **`preview` added to BLOCK_ROLES**: spec §4's role list predates WO-026, whose
  deliverable explicitly requires "subject + preview + body blocks" — the specific work
  order controls; additive, no existing contract broken.
- **Single-CTA is structural**: exactly one `{{cta_link}}` token per body. Prose may
  restate the action, but only one live link ships — checkable, ESP-portable.
- **Unknown merge fields fail closed** (ESPs render unknown tokens as literal text —
  a silent copy defect, so it's a generation error instead).
- **Subject scrub runs at generation time** using the shared G5 config list; WO-030 will
  run the same list over full bodies with readability/specificity/voice scoring.
- Daily-infotainment offsets are 24h steps (day index) so the graph shape is uniform
  across kinds.

**Open questions:** none blocking.

### WO-027 — Generator: ads + advertorial

**Acceptance (restated):** Paid-traffic entry assets per market — Meta (5 primary texts +
10 headlines + 5 descriptions, angle-tagged), YouTube in-stream script (hook ≤5s, 60–90s,
spoken conventions), native headline/teaser sets (10), full advertorial presell (story-led,
disguised-ad disclosure block); each ad tagged to the VSL/letter lead it message-matches
(feeds WO-041). Acceptance: counts met; disclosure block present; angle tags persisted.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **252 tests pass**
(pipeline +10). Verified: Meta counts 5/10/5 enforced by contract (zod `.length`), every
piece carries `meta.angle` + `meta.messageMatch{assetId,lead}`; YouTube script hook-first
with `timestampEnd ≤ 5.1s`, total stamped duration in [57, 94.5]s (60–90 ±5%), spoken
conventions applied; native exactly 10 headline/teaser pairs, angles persisted in block
and version meta; advertorial requires a `meta.section:"disclosure"` block whose text
states it's an advertisement AND must be story-led (first content block role `story`).
Message-match targets are enumerated from the market's persisted VSL lead variants
(version `meta.leadType`) and letter structures (`meta.structure`); a tag not in that set
throws; ads without any VSL/letter in the market refuse to generate. Rejections covered:
wrong counts, unknown target, slow hook, out-of-band duration, missing disclosure,
non-story lead.

**Files touched:**
- `packages/pipeline/src/generators/ads.ts` (+ `ads.test.ts`): `listLeadTargets`,
  shared draft/persist helpers (claims + auto-council per asset), `generateMetaAds`,
  `generateYoutubeAd`, `generateNativeAds`, `generateAdvertorial`,
  `assertDisclosureBlock`, `assertStoryLed`.
- Dispatcher cases `meta_ad`/`youtube_ad`/`native_ad`/`advertorial`; pipeline exports;
  seeds `generate.meta_ads`, `generate.youtube_ad`, `generate.native_ads`,
  `generate.advertorial` (all v1).

**Decisions:**
- **Message-match is validated against persisted reality**, not free text: the tag must
  name an (assetId, lead) pair that exists in this market. WO-041's message-match variant
  map consumes these tags directly.
- **Ads hard-require an existing VSL/letter** — an ad with nothing to message-match is a
  spec violation, and WO-028's orchestrator sequences ads after the core assets anyway.
- **One asset per ad type per run** (a Meta ad *set* is one asset with 20 blocks) — sets
  travel through council/export as units; angle + messageMatch live per block for WO-041.
- YouTube duration checked on stamped duration with the same ±5% tolerance the 170-WPM
  math uses elsewhere; hook budget 5s (skip button) with 0.1s rounding headroom.

**Open questions:** none blocking.

### WO-028 — Fan-out orchestrator + upsell/bump generator

**Acceptance (restated):** One click → full 5-market build, resumable. Job graph builder
with per-market ordered chains maximizing §1.2 cache hits; progress UI (market × asset
grid); resume-from-failure; cancel; upsell + order-bump generator appended to the chain;
single "Build All" action post-G2. Acceptance: kill worker mid-build → resume completes
without duplicates; cache hit rate visible ≥ target from the second market onward.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **262 tests pass**
(core +3, db +2 guard coverage, pipeline +5). Verified: plan is market-major (every asset
for market 1, then market 2 — §1.2's exact ordering rule) with a canonical per-market
sequence (letter → VSL → feeders → webinar → emails → ads → advertorial → upsell → bump)
so ads always find their message-match targets; chained `build.step` jobs keep execution
strictly sequential regardless of worker count; **kill simulation**: a step forced back to
`running` after its asset was created re-runs WITHOUT a second AI call (mock call-count
asserted) and without duplicate assets — exactly one asset per (market, type); cancel
skips pending steps and the in-flight chain job no-ops; a failing step records its error,
`resume` re-arms from the first non-done step and the build completes; cache stats from
`usage_ledger` (jobId → step → market) show market 1 at 0% and market 2 at 90% hit rate
in the harness. Upsell: exactly one accept CTA + required honest decline block
(`meta.section:"decline"`). Order bump: headline/body/checkbox_line, ≤150 words total.

**Files touched:**
- `packages/core/src/buildPlan.ts` (+ test): `FUNNEL_ASSET_SEQUENCE`, `buildFunnelPlan`
  (market-major, subset-preserving); `JOB_TYPES.buildStep`.
- `packages/db/src/schema/builds.ts` + migration 0005: `funnel_builds` (status + plan),
  `funnel_build_steps` (seq-unique, status/jobId/assetIds/error) — both tenant-guarded
  (guard, scan list, guard coverage test).
- `packages/db/src/builds.ts`: `startFunnelBuild` (G2-gated via `assertG2Approved`, G1 via
  `enqueueGenerationJob`, one running build per project), step CRUD, `cancelFunnelBuild`,
  `resumeFunnelBuild`, `buildCacheStats`, `latestBuild`.
- `packages/pipeline/src/generate.ts`: extracted shared `dispatchGeneration` (handler +
  orchestrator use one dispatch); `buildStep.ts`: chained handler with dedupe-by-existing-
  assets resume safety; `generators/upsellBump.ts` (+ tests in buildOrchestrator.test.ts).
- Worker registers `build.step`; seeds `generate.upsell`, `generate.order_bump`;
  web `build` router (start/status/cancel/resume) + `/projects/[id]/build` grid page
  (market × asset glyph grid, per-market + overall cache hit rate, Build All / Cancel /
  Resume buttons).

**Decisions:**
- **Chain-on-completion, not bulk enqueue**: enqueueing all steps upfront would let a
  multi-worker pool run them out of order (cold caches, ads before their VSL). Each step
  enqueues the next — order is structural.
- **Resume dedupe is existence-based**: a step whose (market, type) assets exist with
  `createdAt ≥ build.createdAt` is counted done rather than regenerated. For multi-asset
  steps (email sequences ×4, feeders ×3) a crash mid-step could leave a partial set that
  resume counts as done — accepted trade-off vs. duplicating the completed portion;
  noted for a count-aware repair pass if it bites.
- **Duplicate chain JOBS are tolerated** (a reaped retry may re-enqueue an already-queued
  next step); they no-op on done steps — assets can't duplicate, which is what the
  acceptance demands.
- Cache observability rides the existing ledger (`jobId` linkage) — no new metering.

**Open questions:** none blocking.

### WO-029 — Synthetic Focus Group (G4)

**Acceptance (restated):** 20 personas sampled from the market profile (skepticism and
awareness varied within the diagnosed band) consume the draft in batched fable-5 calls;
per persona: attention-drop block, disbelief-spike claims, bounce reason, spouse-test
quote; aggregate report + marked-up draft with annotations anchored to block ids; §5 G4
thresholds (≥70% reach CTA, no claim disbelieved by ≥50%) config-driven; one-click "fix
annotations" revision pass; report exportable.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **273 tests pass**
(core +7, pipeline +4). Verified: deterministic cohort (skepticism cycles 1–5, awareness
= diagnosed stage ± one, personas lead with real market objections; no RNG — CI-stable);
consumption batched (20 personas / 5 per call → 4 calls asserted); annotations anchor to
REAL block ids — an unknown id is a contract violation that fails the run; disbelief
matched to the claims inventory by normalized containment with one vote per persona per
claim, and each spiking claim's annotation lands on the block that carries it; thresholds
+ cohort size + batch size all config-driven (custom config flips outcomes in tests);
pass → G4 gate report + status `focus_group → deslop`; fail → run + annotations persist,
asset stays in `focus_group`; fix-annotations builds the brief from the failing run's
annotations, produces one revision version (`meta.focusFix`), and re-enters Council
(which now chains a passing G3 straight into G4). Markdown export via
`renderFocusReportMarkdown` + tRPC `focusGroup.exportMarkdown` + download button.

**Files touched:**
- `packages/core/src/focusGroup.ts` (+ test): config, `samplePersonas`,
  persona/batch contracts, `aggregateFocusGroup`, `composeFocusFixBrief`,
  `renderFocusReportMarkdown`.
- `packages/db/src/focusGroupStore.ts`: `insertFocusGroupRun`, `latestFocusGroupRun`
  (existing `focus_group_runs` table — no migration needed).
- `packages/pipeline/src/focusGroup.ts` (+ test): `asset.focus_group` +
  `asset.focus_fix` handlers; councilJob chains G3 pass → G4.
- Worker registrations; seed `focus_group.simulate` v1 (fable-5 route already seeded);
  web `focusGroup` router (latest/run/fixAnnotations/exportMarkdown) +
  `/assets/[assetId]/focus` report page.

**Decisions:**
- **Fail leaves the asset in `focus_group`, not `blocked`** — G4's failure artifact is a
  marked-up draft awaiting the human's one-click fix; `blocked` is for G3 escalation and
  hard gate failures. The fix pass routes `focus_group → revising → council → (G4 again)`.
- **Persona sampling is code, not model output** — the cohort's composition (skepticism
  spread, awareness band, objection coverage) is guaranteed deterministically; the model
  only simulates behavior.
- Batch result cardinality is enforced (a batch must return exactly its personas).

**Open questions:** none blocking.

### WO-030 — De-Slop Gate (G5)

**Acceptance (restated):** Voice capture from founder samples (style card); readability
measure + targeted rewrite loop to the §5 grade band (FK 5–7 spoken / 5–8 written);
specificity injector sourcing numbers/names from profile/VOC only — never invented;
sentence-rhythm variance pass; AI-tell scrubber (config list); voice-match score.
Acceptance: fixture sloppy draft exits within grade band with zero tell hits; the
injector cannot introduce claims absent from claims/profile (tested).

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **286 tests pass**
(core +9, pipeline +4). Verified with a calibrated fixture pair: the sloppy draft
measures grade 16.2 / zero specifics / 0.24 rhythm variance / five AI-tells, and after
one targeted rewrite exits at grade 7.2 (inside 5–8), zero tells, specificity 13.8/100,
variance 0.73 — asserted from the persisted G5 report, not the mock. Injector guard:
a rewrite adding "Ninety-seven percent" (absent from profile/VOC/claims) throws
`injector violation` and the rewrite version is NOT persisted. Voice: with founder
samples, each measure cycle scores the text against the samples (style card captured in
the report); score 40 fails the 70 threshold, post-rewrite 88 passes; without samples no
voice call is made and the dimension doesn't gate. Exhausted loops (config-driven cap)
record a failing G5 and block the asset. Pass transitions `deslop → compliance`;
G4 pass now auto-enqueues `asset.deslop`.

**Files touched:**
- `packages/core/src/deslop.ts` (+ test): `fleschKincaidGrade` (deterministic syllable
  heuristic), `specificityDensity` (digits + spelled numbers + units + mid-sentence
  proper nouns per 100 words), `sentenceRhythm` (coefficient of variation),
  `extractNumberTokens`/`findInventedNumbers` (digit↔spoken-form mapping;
  word-bounded sub-phrase containment only — "seven" in the corpus does NOT
  legitimize "ninety seven"), `measureDeslop`/`evaluateDeslop`, `SPOKEN_ASSET_TYPES`,
  config with grade bands / density / rhythm / voice thresholds / loop cap.
- `packages/pipeline/src/deslop.ts` (+ test): `asset.deslop` handler — measure →
  targeted rewrite loop (failing dimensions only, style card + source material in the
  brief) → guard → re-measure; G5 gate report with per-loop trail; status transitions.
- Worker registration; seeds `deslop.voice` v1 + `deslop.rewrite` v1 (scrub route
  already existed); G4 → G5 chaining in the focus-group handler.

**Decisions:**
- **The measures are code; only voice judgment and rewriting are model work.** Grade,
  tells, density, and rhythm are deterministic — a gate that can't drift with a model.
- **The §5 grade band is enforced as a band** (a floor and a ceiling): grade-2 baby talk
  fails "written 5–8" just as grade-12 sludge does. The bands are config.
- **Invented-number guard runs BEFORE persistence** — a violating rewrite never becomes
  a version; the job fails loudly rather than laundering an invented statistic.
- Voice-match re-scores every loop (the rewrite is supposed to move it).

**Open questions:** none blocking.

### WO-031 — Claims inventory

**Acceptance (restated):** Haiku claim extraction per asset version → `claims` (in place
since WO-022); proof linker UI attaching proof_assets; status proven|flagged; flag report
per asset. Acceptance: G6 blocked while unresolved flags exist in strict modes; claims
survive regeneration via text-similarity rematch.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **294 tests pass**
(core +7, pipeline +1 rich acceptance test). Verified end-to-end: a flagged extraction
gets `lab-cert-2201` attached via the proof linker (→ proven); regenerating a block
re-extracts claims and the PARAPHRASED claim ("…by an accredited independent lab")
inherits the proof and proven status by token-Jaccard rematch, while a genuinely new
claim ("saves five hundred dollars…") arrives flagged; the flag report reflects the
current version (2 total / 1 proven / 1 flagged); attach → 0 flags, detach → 1 flag.
Strict-mode precondition: `assertClaimsResolvedForStrictMode` throws with the flag list
in health/finance mode and never gates in `none` — this is the exact check WO-032's G6
will call.

**Files touched:**
- `packages/core/src/claimsMatch.ts` (+ test): `claimSimilarity` (stopword-free token
  Jaccard), `rematchClaims` (threshold-driven carry of proofRef/status; matching a
  FLAGGED prior never fabricates proof; incoming proof_refs keep their own),
  `buildClaimsFlagReport`, `assertClaimsResolvedForStrictMode`.
- `packages/db/src/assetsStore.ts`: `insertClaims` now rematches against the asset's
  existing claims on every insert (fresh assets: no-op); `listCurrentClaims`,
  `attachClaimProof`, `resetClaimToFlagged`, `claimsFlagReport`.
- `packages/pipeline/src/regenBlock.ts`: regenerated versions re-extract claims
  (haiku stage) with the profile's proof assets; store-level rematch carries proofs.
- Web `claims` router (list + report + attachable proof assets, attachProof, flag) and
  the `/assets/[assetId]/claims` proof-linker page.

**Decisions:**
- **Rematch lives in `insertClaims`** — one choke point every extraction path already
  goes through, so survival works for generator drafts, sibling VSL variants, and
  regenerations without per-caller wiring.
- **Similarity is deterministic** (token Jaccard ≥ 0.55, stopwords dropped) — a
  compliance-adjacent behavior should not depend on a model's mood; threshold is a
  parameter.
- The proof linker offers the profile's `proof_assets` as a picker but accepts free-text
  refs (proof can live outside the profile, e.g. a URL).

**Open questions:** none blocking.

### WO-032 — Compliance pre-flight (G6)

**Acceptance (restated):** Rule packs — FTC (testimonials/endorsements, earnings), health
mode (disease-claims list), finance mode (earnings disclaimers required), Meta/Google
ad-policy lint (personal attributes, before/after, sensational); per-asset report with
line refs; required-disclaimer inserter; acknowledge-with-audit for lint warnings (never
for strict-mode claim failures). Acceptance: rule packs unit-tested with fixture
violations; strict modes fail closed.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **308 tests pass**
(core +10, pipeline +4). Verified per pack with fixture violations: FTC earnings claim
without typicality disclaimer (silenced by "results are not typical"), undisclosed
testimonial, guaranteed-outcome ERROR; health-mode disease-claim ERROR ("cures diabetes")
and diagnosis-language warning — and health rules do NOT run outside health mode; finance
earnings-without-disclaimer ERROR (silenced by a disclaimer) and risk-free ERROR;
ad-policy personal attributes / before-after / sensational warnings. Findings anchor to
the carrying block id with the matched excerpt (line refs). Handler flow proven: health
mode + one flagged claim → G6 fails CLOSED (`failClosed`, `acknowledgeable:false`), and
after attaching proof the re-run passes → `packaging`; unacknowledged warnings block,
`recordComplianceAck` (audited: actor + reason on `audit_log`) flips the re-run to pass;
acknowledging an ERROR's key changes nothing; finance mode auto-inserts the required
disclaimer as a locked new-version block — which itself satisfies the earnings-disclaimer
rule.

**Files touched:**
- `packages/core/src/compliance.ts` (+ test): `COMPLIANCE_RULES` (regex config with
  `unlessPresent` silencers), `packsForMode`, `runCompliancePacks`,
  `REQUIRED_DISCLAIMERS`/`insertRequiredDisclaimer` (idempotent),
  `evaluateCompliance` + finding keys (`ruleId:blockId`).
- `packages/db/src/complianceStore.ts`: version-scoped acknowledgments on `audit_log`
  (`compliance.acknowledge`) — a new version voids old acks by construction.
- `packages/pipeline/src/compliance.ts` (+ test): `asset.compliance` handler —
  claims-flag fail-closed → disclaimer inserter → packs → ack-aware verdict; pass →
  `packaging`, fail stays in `compliance`. G5 pass now auto-enqueues G6.
- Web `compliance` router (latest/run/acknowledge) + `/assets/[assetId]/compliance`
  panel with per-finding checkboxes and the audited-reason field.
- Fixed a latent sort-tie bug: consecutive gate reports within one second now tiebreak
  by ULID (router + tests).

**Decisions:**
- **G6 is fully deterministic — zero AI calls.** A compliance gate must be reproducible
  and auditable; regex packs are config to extend.
- **Acks are per (rule, block) per VERSION** — regenerating invalidates acknowledgments
  automatically; nobody inherits an old acknowledgment onto new copy.
- **Fail leaves the asset in `compliance`** (like G4's fail posture): every failure mode
  has a user action (prove claims, acknowledge, fix copy) followed by a re-run.
- The disclaimer inserter runs BEFORE the packs so its own text can satisfy
  disclaimer-required rules in the same pass.

**Open questions:** none blocking.

### WO-033 — Gate dashboard

**Acceptance (restated):** Project view of the market × asset grid with G3–G7 states;
block/approve/override (owner-only, audited with reason); gate report drill-ins; bulk
actions. Acceptance: override writes `audit_log` + `gate_reports.overridden_by`; grid
reflects live worker updates.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **312 tests pass**
(db +4). Verified: the grid derives each asset's G3–G7 cells from the LATEST gate report
(ULID tiebreak), marking overrides distinctly; drill-in returns the full report with
override metadata. Override records a passing report carrying `overridden_by` + reason,
writes a `gate.override` audit row, resumes the asset at the post-gate stage (with the
audited `blocked`-override path when needed) and re-enqueues the next automated gate job
(G3→focus group, G4→deslop, G5→compliance) — asserted end-to-end: a blocked asset
overridden at G5 lands in `compliance` with an `asset.compliance` job queued. Block and
approve are audited status actions; an empty reason is refused.

**Files touched:**
- `packages/db/src/gatesDashboard.ts` (+ test): `projectGateGrid`, `gateReportDetail`,
  `overrideGate` (report + audit + resume + re-enqueue), `blockAsset`, `approveAsset`,
  gate→post-status/job maps.
- Web `gates` router: grid/report queries (workspace), override/block/approve mutations
  (**ownerProcedure**, arrays for bulk, reason min-length enforced) — mounted in _app.
- `/projects/[id]/gates` page: checkbox multi-select with bulk action bar, per-cell
  glyphs (● pass / ✕ fail / ◉ override / · not run), click-to-drill JSON report,
  3-second polling so worker updates surface live.

**Decisions:**
- **Override = a new PASSING gate report, never a mutation of the failing one** — the
  failure stays in history; the override sits on top with its author and reason.
- **Override also re-arms the pipeline** (status + next gate job) — a dashboard override
  should put the asset back in motion, not leave it stranded mid-flow.
- Bulk actions iterate server-side over the id array with the same single-asset code
  path — no separate bulk semantics to test or drift.
- "Live" is client polling (3s) against the grid query; the workers write the same
  tables the query reads, so no push infrastructure is needed yet.

**Open questions:** none blocking.

### WO-034 — produce CLI v2

**Acceptance (restated):** `npm run produce -- --project <id> --phase build
[--markets 1,2] [--assets vsl,email]` — streams progress, emits a JSON summary with
per-asset gate outcomes, exits non-zero on any blocked asset. Acceptance: a fixture
project builds end-to-end headless in CI with mocked AI; the summary schema is stable.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **315 tests pass**
(cli +3). The acceptance test is the real thing: a fixture project (G0–G2 complete, 5
diagnosed markets) runs `runBuildPhase` with a content-ROUTED mock transport and drains
the entire cascade inline — build.step chain → generators → claims → G3 council (6
lenses × 2 assets = 12 routed lens calls) → G4 focus group (20 personas × 2 assets = 8
batched calls, persona ids echoed from the request) → G5 de-slop (deterministic; the
fixture copy is calibrated to pass in-band) → G6 compliance → `packaging`. Summary
asserts: stable top-level schema (exact key set), build done, steps done, both assets
`{G3..G6: pass, G7: null}`, zero failed jobs, progress lines streamed. The blocked path:
a sloppy upsell whose G5 rewrite fixes nothing exhausts its loops → asset `blocked`,
`summary.blocked` carries it, `ok:false` (→ exit 1). Missing G2 → `error` mentions G2.

**Files touched:**
- `apps/cli/src/build.ts` (+ `build.test.ts`): `runBuildPhase` — starts the fan-out
  build, drains THIS workspace's queue inline with the same handler registry the worker
  uses (build.step / generate / council / focus_group / deslop / compliance), streams
  per-job progress, assembles the summary from build steps + `projectGateGrid`.
- `apps/cli/src/index.ts`: `--phase build` wiring with `--markets`/`--assets` parsing,
  JSON summary to stdout, exit code from `summary.ok`; help text updated.

**Decisions:**
- **The drain is workspace-scoped and registry-filtered** — it processes only THIS
  workspace's jobs of known types, never claiming another tenant's work (the global
  fair-scheduler claim path is the worker's job, not the CLI's).
- **Headless failures don't retry** — a failed job is marked failed immediately and
  surfaces in the summary; retry/backoff is queue-worker behavior, not CI behavior.
- Failed-job cap (`maxJobs`, default 2000) backstops runaway chains in CI.
- Summary schema is asserted key-for-key in the test, making accidental breaking
  changes to the contract a test failure (acceptance: "summary schema stable").

**Open questions:** none blocking.

### WO-035 — Page Build Package composer (G7)

**Acceptance (restated):** Composer assembling copy_blocks + design brief (visual
hierarchy mapped to the persuasion sequence; CTA choreography — sticky CTA timing, buy
reveal keyed to VSL timestamp or letter block), VideoObject JSON-LD for VSL pages, quiz
embed ref, message-match variant map, acceptance_criteria + self_qa_checklist generation;
contract validation + checksum; G7 record. Acceptance: package validates; checksum stable
across identical inputs; missing renderings block G7.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **324 tests pass**
(core +6, pipeline +3). Verified: identical inputs compose byte-identical packages with
equal checksums, and two live handler runs on the same asset persist rows with the SAME
checksum; changing one block changes it. Renderings are excluded from the checksum by
design (they carry machine-local paths and are filled by WO-036–038), proven by test.
Missing renderings fail `checkG7` with the exact missing list; after
`updatePackageRenderings` a recompose preserves them, keeps the checksum, and G7 passes.
VideoObject JSON-LD derives from the 170-WPM stamps (754s → PT12M34S) with
`t:` choreography (buy reveal at the offer's timestamp, sticky CTA one beat earlier);
letters key off `block:` ids. The message-match variant map derives from WO-027's
ad↔lead tags at BOTH granularities (per-block Meta pieces, whole-script YouTube/
advertorial), resolving each tagged lead to that variant's headline/lead block ids.
Acceptance criteria + self-QA are content-driven (video adds the JSON-LD line, quiz adds
the embed line, variants add the no-layout-shift line). G6 pass now chains
`asset.package`; worker + headless CLI registries updated (CLI summary now shows G7
'fail' until the renderers land).

**Files touched:**
- `packages/core/src/contracts/pageBuildPackage.ts`: the §4 contract (zod) + `checkG7`.
- `packages/core/src/packageCompose.ts` (+ test): deterministic composer —
  `buildDesignBrief` (role→weight/directive maps), `buildVideoObject`,
  `buildAcceptanceCriteria`, `buildSelfQaChecklist`, `composePageBuildPackage`,
  `packageChecksum` (canonical JSON, renderings excluded).
- `packages/db/src/packagesStore.ts`: `savePackage`, `latestPackage`,
  `updatePackageRenderings`.
- `packages/pipeline/src/packageJob.ts` (+ test): `asset.package` handler +
  `collectUtmVariants`; G6→G7 chaining; worker + CLI registration.

**Decisions:**
- **G7 composition is 100% deterministic — zero AI.** Checksum stability is an
  acceptance criterion; a model call anywhere in the compose path would break it.
- **Checksum covers content, not renderings** — the checksum identifies the deliverable
  the renderings must faithfully carry; filling them in cannot change identity.
- **Packages are insert-newest (full history), latest wins** — recomposition after a
  copy change yields a new row and a new checksum; nothing is destroyed.
- G7 pass does NOT auto-approve: `packaging → approved` stays the owner's signature
  (WO-033 dashboard).

**Open questions:** none blocking.

### WO-036 — Export renderer (files)

**Acceptance (restated):** Per-asset exports — Markdown always; semantic unstyled HTML
for letters/advertorials/quiz results; VSL/webinar teleprompter TXT with a 170-WPM block
timing header; email sequence as an .md pack; per-market ZIP; export history.
Acceptance: exports byte-reproducible from a package; ZIP contains manifest.json listing
checksums.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **333 tests pass**
(core +7, pipeline +2 heavy integration). Verified: every renderer is a pure function of
the package — two renders are string-identical and two disk exports carry identical
sha256 checksums, re-verified by reading the bytes back; the per-market ZIP is
byte-reproducible too (fixed DOS timestamp, STORE method) and its `manifest.json` lists
per-file checksums that match the actual zipped bytes plus the source package checksums.
Teleprompter TXT: `PACE: 170 WPM`, total runtime, and `[MM:SS → MM:SS]` per block. HTML
is semantic and escaped (h1 headline, ul bullets, sectioned by block id, VideoObject
JSON-LD when present). Email pack: one .md per email (subject/preview/offset/phase
header + body) plus a `00-sequence.md` index. Export history rows per file and per zip.
The package job now renders files inline, filling `renderings.file_paths` — G7's missing
list shrinks to the two prompts (WO-037/38).

**Files touched:**
- `packages/core/src/exportRender.ts` (+ test): `renderMarkdown`/`renderHtml`/
  `renderTeleprompter`/`renderEmailPack`/`renderAssetFiles`, `contentChecksum` (sha256),
  and a dependency-free deterministic STORE-method ZIP (`crc32` verified against the
  standard test vector, `zipStore`, `readStoreZip`).
- `packages/db/src/exportsStore.ts`: `recordExport`, `listExportsForAsset/Market`.
- `packages/pipeline/src/exporter.ts` (+ test): `exportAssetFiles` (write + history +
  renderings update), `exportMarketZip` (manifest + zip + history), `EXPORT_DIR` root
  (documented in .env.example, gitignored).
- `packageJob.ts` renders files inline after composing.

**Decisions:**
- **The ZIP is hand-rolled STORE-method** — no new dependency, and compression would
  trade the byte-reproducibility acceptance for a few KB. Fixed DOS timestamp
  (2020-01-01) because zip timestamps are the classic determinism leak.
- **Renderers live in core (pure)**; only the writer (fs) lives in pipeline — the same
  render functions serve the ZIP, the files, and future preview UIs.
- File names derive from asset type + id suffix; email packs render into a
  subdirectory with a numbered index.

**Open questions:** none blocking.

### WO-037 — Macaly prompt compiler

**Acceptance (restated):** Versioned registry template rendering page goal,
section-by-section VERBATIM copy injection (DO-NOT-REWRITE fenced), design-brief
directives, mobile-first + load-speed directives, VideoObject/schema embed instructions,
quiz embed snippet, form/CTA wiring, final self-check list; copy-to-clipboard UI.
Acceptance: prompt contains 100% of copy blocks verbatim (asserted); ≤ Macaly practical
length budget (config) with overflow strategy (split into build + refine prompts).

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **337 tests pass**
(core +4, pipeline assertions extended). Verified: the compiled prompt carries every
copy block character-for-character inside DO-NOT-REWRITE fences — asserted independently
in the test AND enforced fail-closed by `assertBlocksVerbatim` inside the compiler; a
20-section fixture over a 6k budget splits into PART 1 (BUILD, with placeholder
instructions for later parts) + REFINE parts, each within ~budget, whose UNION still
carries every block verbatim; the pipeline test confirms the stored package's
`renderings.macaly_prompt` contains all VSL blocks and G7's missing list has shrunk to
just the universal prompt. The template lives in the prompt registry (`macaly.build` v1)
so it versions like every other prompt; the compiler itself is deterministic
substitution — checksum-safe, zero AI.

**Files touched:**
- `packages/core/src/macalyCompile.ts` (+ test): `compileMacalyPrompt` (template vars:
  page_goal / sections / cta_wiring / schema_embed / quiz_embed / self_check /
  part_note), `DEFAULT_MACALY_BUDGET_CHARS` (24k, parameterized), overflow splitter,
  `assertBlocksVerbatim`, `joinPromptParts`.
- Seed `macaly.build` v1 (the one-shot build template: copy rule, mobile-first +
  load-speed directives, CTA wiring, structured data, self-check).
- `packageJob.ts`: compiles the Macaly prompt after file export and persists it into
  the package renderings.
- Web `packages` router + `/assets/[assetId]/prompts` page with copy-to-clipboard
  cards for both prompts and the live G7 missing-list.

**Decisions:**
- **The compiler is code; the template is registry content.** Wording iterations ship
  as new prompt versions (pinnable per asset like all prompts); the mechanical
  guarantees (verbatim fences, budget, split) live in tested code.
- **Verbatim assertion is fail-closed inside the compiler** — a template edit that
  drops `{{sections}}` cannot silently ship a prompt without the copy.
- Split parts each restate the full copy rule and self-check — a refine prompt pasted
  into a fresh Macaly session still carries its own guardrails.

**Open questions:** none blocking.

### WO-038 — Universal LLM prompt compiler

**Acceptance (restated):** Template producing role framing, full package payload, tech
constraints (single-file HTML or user-selected stack), explicit acceptance criteria, a
self-QA checklist the model must verify line-by-line before declaring done, and the
zero-placeholders output instruction; variant flags `--stack single-html|nextjs`.
Acceptance: prompt tested against a live model on one fixture package renders passing
its own checklist (manual sign-off ok).

**Status:** ✅ Complete (structural). Typecheck/build/lint green, scans clean, **355
tests pass** (core +3). Verified: copy blocks ride in plain-text DO-NOT-REWRITE fences —
verbatim even for text containing quotes/newlines (a JSON-only payload would escape them
and break the guarantee), asserted fail-closed by the shared `assertBlocksVerbatim`; the
canonical payload carries the design brief / CTA choreography / media schema / variants
but NOT copy_blocks (no duplication drift); stack variants swap the tech-constraints
section (`single-html`: one self-contained file that renders from file://; `nextjs`: App
Router + file tree + `next build` clean) and an unknown stack throws; criteria and QA are
numbered for the line-by-line verification instruction. The package job compiles the
default single-html variant — with WO-036–038 all wired, **G7 now passes end-to-end**:
the pipeline test asserts an empty missing list and both prompts verbatim, and the CLI
headless fixture now shows the full gate ladder G3–G7 = pass.

**Files touched:**
- `packages/core/src/universalCompile.ts` (+ test): `compileUniversalPrompt`,
  `UNIVERSAL_STACKS`, per-stack constraint config.
- Seed `universal.build` v1 (role framing, locked-copy rule, payload application
  directives incl. utm variant swap implementation, line-by-line QA, zero-placeholder
  output rules).
- `packageJob.ts` compiles the universal prompt (default stack) after Macaly.
- Web `packages.compileUniversal` mutation (the `--stack` variant flag surface) +
  stack buttons in the prompts panel.

**Decisions:**
- **Copy travels in fences, payload in JSON** — the verbatim guarantee must survive
  JSON escaping, so the copy is never only inside the payload.
- **The live-model acceptance is intentionally left as the user's manual sign-off**
  (the acceptance text allows it): CI never spends tokens per the WO-006 mandate, so
  the harness proves composition, and the human proves the render once against a real
  model from the prompts page.

**Open questions:** live-model sign-off pending (user action; one fixture package via
the copy-to-clipboard prompt).

### WO-039 — Quiz builder

**Acceptance (restated):** Generator producing 5–8 questions sorting respondents into the
5 market buckets (options weight-mapped to markets), prequal budget/urgency questions
with disqualification, weighted scoring, score bands, per-band results copy (that
market's short-form letter + CTA), lead capture between last question and results,
editor UI for questions/weights/bands. Acceptance: routing simulator — 1,000 synthetic
answer sets distribute to expected buckets; disqualified path renders
decline-with-dignity and is tagged.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **349 tests pass**
(core +6, pipeline +3). Verified: pure weighted-sum scoring with deterministic
band-order tiebreak (a constructed genuine tie proves it) and any disqualifying option
tagging the respondent; structural validation rejects too-few routing questions, missing
disqualify options, unknown-market weights, and UNREACHABLE markets (no option
top-weights them); the routing simulator generates 1,000 seeded synthetic answer sets
(deterministic LCG — no Math.random, CI-stable), routes ≥70% of each market-biased
cohort to its bucket, and tags 100/100 disqualified sets. **The simulator is a hard
generation gate**: the pipeline handler validates, simulates, and refuses to persist an
incoherent quiz (proven with a sabotage whose ambiguous equal weights pass structure but
collapse routing — nothing lands in quiz_definitions). Generated weights are re-keyed
from model-friendly ranks to real market ids; bands map 1:1 to markets with short-form
letter + CTA result blocks; the decline page and lead-capture step persist in scoring.
Editor UI: per-option weight matrix per market, save-with-validation, live simulation
readout.

**Files touched:**
- `packages/core/src/contracts/quiz.ts` (+ test): quiz contract, `validateQuizDefinition`
  (incl. the reachability rule), `scoreQuizAnswers`, `simulateRouting`, `seededRandom`.
- `packages/db/src/quizStore.ts`: upsert-per-project definition, `getQuizBySlug`
  (public runtime path for WO-040), editor update.
- `packages/pipeline/src/quizBuilder.ts` (+ test): `quiz.generate` handler with the
  validate→simulate→persist gate; rank→id weight mapping; worker registration.
- Seed `quiz.generate` v1; web `quiz` router (generate/get+simulate/update) +
  `/projects/[id]/quiz` editor page.

**Decisions:**
- **Simulation is a generation-time gate, not just a report** — a quiz that cannot route
  never reaches the database, so the runtime (WO-040) can trust any stored definition.
- **The model weights by market RANK** (1–5) — small, unambiguous keys a model won't
  typo — and the handler re-keys to market ids on ingest.
- Seeded LCG randomness keeps the 1,000-set simulation reproducible in CI; JS
  integer-like object keys enumerate numerically (a real footgun found while testing —
  documented here for posterity).

**Open questions:** none blocking.

### WO-040 — Quiz runtime

**Acceptance (restated):** (a) hosted Next.js `/q/[slug]` — one question per screen,
progress bar, mobile-first; (b) embeddable SINGLE-FILE HTML export (self-contained,
posts to the hosted API); sessions/answers/leads persistence; routed inline render of
market-variant results; CRM webhook out (configurable URL, payload = lead + band +
answers); ledger events (quiz_start/complete/optin). Acceptance: single-file export runs
from file:// and third-party pages; session funnel metrics recorded; webhook retries
with backoff.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **358 tests pass**
(core +3 incl. a REAL-BROWSER acceptance test, db +3, pipeline +3). The file://
acceptance runs headless Chromium (playwright-core devDep + the preinstalled browser)
against the generated single file at 375px: question 1 renders with zero network
(questions are embedded; only weights/disqualify stay server-side), answering advances
one-question-per-screen with the progress bar, and the lead-capture step appears between
the last question and results. Structural test proves self-containment: inline CSS/JS,
no external src/href/@import/url(), the only absolute URL is the API base. Runtime flow
proven end-to-end in the db test: start (idempotent per sessionRef, deduped quiz_start
event) → answers (invalid options rejected) → complete → lead routed to the right
market band with results copy, `quiz_complete` + `optin` events, and the CRM webhook job
queued with lead+band+answers payload; the disqualified path returns
decline-with-dignity, tags the lead, and shows in funnel metrics
(starts/completes/optins/disqualified). Webhook delivery throws on non-2xx so the
queue's exponential backoff (WO-007) IS the retry mechanism (maxAttempts 6). Offline
embeds backfill answers at completion (validated against the definition).

**Files touched:**
- `packages/db/src/eventsStore.ts`: replay-safe `recordEvent` (unique dedupe_key,
  duplicates collapse silently) — WO-043 builds on this.
- `packages/db/src/quizRuntime.ts` (+ test): sessions/answers/completion with
  server-side scoring, lead + events + webhook enqueue, `publicQuizView` (weights and
  disqualify flags NEVER leave the server — asserted), `quizFunnelMetrics`.
- `packages/core/src/quizEmbed.ts` (+ tests): the single-file embed renderer.
- `packages/pipeline/src/webhook.ts` (+ test): `webhook.deliver` handler (injectable
  fetcher); worker registration.
- Web: public CORS'd API routes `/api/quiz/[slug]/{start,answer,complete}` (embeds run
  from any origin), public hosted page `/q/[slug]` with the mobile-first runtime,
  `quiz.deploy` tRPC (hosted URL + downloadable single-file HTML + metrics).

**Decisions:**
- **Scoring is exclusively server-side** — the embed carries only question/option text;
  weights and disqualification logic are not inspectable client-side.
- **Rendering never blocks on the network**: the session starts fire-and-forget and
  answers backfill at completion, which is what makes true file:// operation possible.
- **Webhook retries ARE the job queue** — no second retry mechanism to maintain; a
  non-2xx throws and the queue backs off exponentially to max attempts.
- playwright-core added as a devDependency (test-only) to drive the preinstalled
  Chromium for the acceptance test.

**Open questions:** none blocking.

### WO-041 — Message-match runtime

**Acceptance (restated):** `utm_variant_maps` linking utm_content/campaign → headline+lead
variant, auto-seeded from WO-027's ad↔lead tags; drop-in JS snippet + hosted middleware
performing the swap without layout shift; congruence report (tagged ads with no mapped
variant flagged); variant impressions logged to the ledger. Acceptance: swap under 50ms
after first paint in a test page; unmapped UTM falls back to control cleanly.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **362 tests pass**
(core +3 incl. two real-browser tests, pipeline packaging test extended). The acceptance
runs in headless Chromium against a live local test server: the snippet swaps the tagged
headline+lead **within 50ms of first paint** (measured via `performance` paint entries vs
the snippet's swap mark), the visibility-hold style is removed (boxes keep their size —
no layout shift), untouched copy stays untouched, and the impression POST lands on the
middleware with `matched:true`. Fallback proven: an unmapped utm_content retains the
control copy and reveals cleanly; a page with NO utm_content makes **zero** middleware
calls. Maps auto-seed during packaging from the same ad↔lead tags that build the package
variant list — carrying the variant TEXTS the runtime injects (`lookupUtmVariant`
returns "Hook for story." etc.); re-packaging re-seeds idempotently. The congruence
report maps every tagged ad piece against the seeded maps and flags tags whose target
was never packaged. Impressions land in the ledger as replay-safe `page_view` events
(`kind: mm_impression`).

**Files touched:**
- `packages/core/src/mmSnippet.ts` (+ browser tests): the inline drop-in snippet
  (visibility-hold, hold budget fallback, sendBeacon impressions, `__mmSwapAt` timing
  mark).
- `packages/db/src/utmStore.ts`: `seedUtmVariantMaps` (replace-per-asset),
  `lookupUtmVariant` + `utmMapWorkspace` (public runtime path),
  `recordVariantImpression`, `congruenceReport`.
- `packageJob.ts`: `collectUtmVariants` now carries variant texts; packaging auto-seeds
  the maps.
- Web: public middleware `GET /api/mm/[assetId]` (CORS + 60s cache) and
  `POST /api/mm/[assetId]/impression`; `messageMatch` router (snippet + congruence).

**Decisions:**
- **The snippet holds visibility, not display** — hidden boxes keep their dimensions,
  so the swap cannot shift layout; a 150ms hold budget guarantees control renders even
  if the middleware is unreachable.
- **Control traffic pays nothing**: without utm_content the snippet returns before
  touching the DOM or the network.
- **The map stores resolved TEXT**, not block references — the public middleware needs
  one indexed read and zero joins to stay inside the 50ms budget.

**Open questions:** none blocking.

### WO-042 — Delivery Center

**Acceptance (restated):** Per-project browse of packages/exports/prompts, copy buttons,
regenerate-single-block, per-market ZIP download, quiz links + embed codes, message-match
snippet, "what to do next" checklist per asset. Acceptance: a new user can go from
approved build → live-ready files/prompts without touching another screen.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **365 tests pass**
(core +3). The Delivery Center is one page (`/projects/[id]/delivery`) that aggregates
every deliverable surface built in this phase: per-market asset cards with package/G7
state, one-click copy for the Macaly prompt, the universal prompt, and the message-match
snippet (fetched fresh via tRPC utils at click time), the quiz deploy strip (hosted link,
single-file embed copy, live funnel metrics), the congruence warning strip for tagged
ads with unseeded maps, an inline regenerate-single-block control (reusing the WO-021
job), and per-market ZIP download streaming through a new authenticated, tenant-guarded
export download route. The "what to do next" checklist is a pure, tested function of the
asset's pipeline position: gate-stage assets get their fix-it action (fix annotations /
proof linker / override), packaged assets get the copy-prompt → deploy → snippet → mark-
live walk, spoken assets get the teleprompter step, incomplete packages point at G7.

**Files touched:**
- `packages/core/src/nextSteps.ts` (+ test): `nextStepsForAsset`.
- Web `delivery` router (overview aggregation, marketZip build+download handle, export
  history), authenticated `/api/exports/download` route (tenant-scoped via the guard,
  410 on missing files), `/projects/[id]/delivery` page + panel; apps/web now depends
  on @copyforge/pipeline (for the ZIP exporter).

**Decisions:**
- **Copy buttons fetch at click time** — prompts can be megabyte-scale, so the overview
  stays light and the clipboard payload is always the freshest compile.
- **Downloads stream through an authenticated route** rather than exposing filesystem
  paths; the guard scopes the export row lookup, and a vanished file returns 410 with a
  regenerate hint.
- The acceptance is a UX property; the structural guarantee (every needed artifact and
  action reachable from the one page) is in place, with the end-to-end click-through
  left to the user's walkthrough.

**Open questions:** none blocking.

### WO-043 — Event ingestion

**Acceptance (restated):** `events` per §4 with dedupe_key uniqueness; adapters — Ringba
webhook (call_start/qualified, campaign→market map UI), native quiz events (WO-040),
generic pixel + webhook (page_view, vsl_quartile 25/50/75/95, optin, sale, refund),
email metrics CSV import; per-project ingest keys; replay-safe. Acceptance: duplicate
deliveries collapse; fixture streams populate dashboards; unmapped events land in triage,
not dropped.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **373 tests pass**
(core +2, db +4 heavy, +2 guard coverage entries). Migration 0006: `projects.ingest_key`
(unique), `event_triage`, `campaign_market_maps` — both new tables tenant-guarded (guard
+ scan list + coverage test). Verified: ingest keys generate/rotate and the OLD key dies
on rotation; Ringba deliveries with unmapped campaigns park in triage with an actionable
reason and record ZERO events, then route with the marketId attached once the campaign is
mapped, with duplicate call deliveries collapsing on `ringba:<callId>:<event>`; the pixel
adapter validates quartiles (25/50/75/95), dedupes per session/type/quartile, and parks
junk (bad quartile, unknown type, missing sessionRef) in triage; the email CSV path
parses case-insensitively with per-row deterministic dedupe hashes so a full re-import
records 0 and collapses 2/2. Triage rows resolve/discard with status tracking. The
public adapter route (`/api/ingest/<key>/<ringba|pixel>`) returns 202 for triaged
deliveries so senders don't retry parked payloads. UI: key + endpoints, campaign→market
map editor, CSV import, triage queue with resolve/discard.

**Files touched:**
- Migration 0006 + `schema/ingest.ts` (event_triage, campaign_market_maps) +
  `projects.ingest_key`; guard/scan/coverage updates.
- `packages/core/src/emailCsv.ts` (+ test): CSV parse with per-row dedupe hashing.
- `packages/db/src/ingestStore.ts` (+ test): keys, triage, campaign maps, and the
  three adapters (`ingestRingbaEvent`, `ingestPixelEvent`, `ingestEmailMetrics`).
- Web: public `/api/ingest/[key]/[adapter]` route, `ingest` tRPC router,
  `/projects/[id]/ingest` settings page.

**Decisions:**
- **Triage is the only failure destination** — every malformed or unmapped delivery
  becomes a queryable row with a human-readable reason; nothing is silently dropped.
- **202 for triaged deliveries**: the payload is safely parked, so upstream retry loops
  (which would just re-triage) are discouraged at the HTTP level.
- Ingest keys are `ck_`-prefixed 48-hex, unique at the DB level, and the ONLY
  authentication on the public adapters — rotation is the kill switch.
- "Fixture streams populate dashboards" completes in WO-046 when the dashboards exist;
  the event fixtures written here are the streams those dashboards will render.

**Open questions:** none blocking.

### WO-044 — Controls & challengers

**Acceptance (restated):** Control designation per (project, market, asset_type) — first
approved asset auto-control; challenger creation from Council escalation notes,
focus-group annotations, or ledger weak points; lifecycle queued→live→won|lost;
promotion rule = min sample size AND uplift beyond a significance heuristic (config,
documented honestly as directional); promotion swaps the control with full history
retained. Acceptance: promotion impossible below min volume; history immutable; UI shows
control lineage.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **383 tests pass**
(core +5, db +3, pipeline +2). Verified: the FIRST owner-approved asset per
(project, market, type) auto-designates as control from inside `approveAsset`, and a
second approval never steals the slot; the promotion heuristic (one-sided two-proportion
z-test + relative-uplift floor + per-arm volume floor, all config) refuses below-volume
data even at massive challenger uplift, refuses sub-floor uplift even at n=100k, refuses
insignificant z, and its promote message SAYS it is directional; `promoteChallenger`
throws below volume (control pointer proven untouched), and on success swaps the
pointer, marks the challenger `won`, and appends `control.promoted` to the lineage —
designation → creation → promotion read back ordered and append-only, with challenger
rows retained forever. Losing challengers mark `lost` without moving the control.
Challenger generation briefs from the control's OWN recorded weaknesses (revise-verdict
council top_fixes, focus-group annotations with block anchors, ledger CVR) and produces
a parent-linked asset with `createdBy: 'challenger'` that re-enters the gates at G3.

**Files touched:**
- `packages/core/src/promotion.ts` (+ test): `evaluatePromotion` +
  `DEFAULT_PROMOTION_CONFIG` (200/arm, +10% uplift, z≥1.64) with the honesty note in
  the doc comment AND the promote reason.
- `packages/db/src/controlsStore.ts` (+ test): designation, lifecycle, `armMetrics`
  (ledger page_view/sale counts), `promoteChallenger`, `controlLineage`, `listControls`;
  `approveAsset` now auto-designates.
- `packages/pipeline/src/challenger.ts` (+ test): `buildChallengerBrief` +
  `challenger.generate` handler; worker registration.
- Web `controls` router (list with metrics+lineage, createChallenger, setLive,
  owner-only promote/markLost) + `/projects/[id]/controls` page with the lineage
  disclosure per control.

**Decisions:**
- **Lineage lives in append-only audit rows + immutable challenger rows** — the controls
  table stays one-pointer-per-slot (as the schema demands) while history is
  reconstructable and tamper-evident.
- **The heuristic's honesty is part of the API**: the promote verdict text itself warns
  it is directional; the config doc comment lists what it does NOT correct for
  (peeking, multiple comparisons, novelty).
- Challenger briefs quote the control's real weaknesses verbatim — the generation is
  aimed, not random.

**Open questions:** none blocking.

### WO-045 — Predictions & Brier scoring

**Acceptance (restated):** At approval, record predictions (quiz optin rate, VSL 50%
retention, letter CVR, email open) with probability bands; resolver job matches actuals
from the ledger at volume thresholds; Brier score per prediction; calibration job
adjusts calibration_state (Council lens weights ±20% cap, prediction priors) — §6
floors never lowered; calibration report. Acceptance: Brier math unit-tested;
calibration provably bounded; predictions display alongside actuals per asset.

**Status:** ✅ Complete. Typecheck/build/lint green, scans clean, **391 tests pass**
(core +5, db +3, pipeline quiz assertion). Verified: `approveAsset` records the asset's
headline-metric forecast (VSL→50% retention, letter→CVR, email sequence→open rate) from
the workspace's CALIBRATED prior with its band, exactly once; quiz definitions forecast
optin rate at generation. The resolver refuses below the per-metric volume floor
(40 starts → unresolved) and above it computes the actual from the ledger (100 starts /
60 q50 reaches → 0.60), stamps the Brier score ((0.35−0.60)² verified to 5 places), and
the project listing pairs predicted/band/actual/brier per asset. Calibration is
PROVABLY bounded: 10× actuals clamp the prior factor at exactly 1.2, zero actuals at
0.8, a corrupted state factor of 99 still applies as 1.2 at read time, ten successive
self-fed calibration rounds never push a lens weight past the ±20% council band
(saturates at exactly 1.2), the adjustments object structurally contains NO floor field,
and the council's own floor constant stays 70. The next approval after calibration
forecasts 0.35 × 1.2 — the loop closes. Resolver + calibration ship as deterministic
jobs (`predictions.resolve`, `calibration.run`) for WO-048's nightly schedule, plus
run-now buttons on the new `/projects/[id]/predictions` page.

**Files touched:**
- `packages/core/src/brier.ts` (+ test): `BASE_PRIORS` (config), `metricForAssetType`,
  `brierScore`, `calibratedPrior` (read-time clamp), `computeCalibration`
  (half-step toward observed mean, factor clamp, ±0.05/run lens nudges through the
  existing `clampWeights`, ≥4-sample gate, report with the bounds statement).
- `packages/db/src/predictionsStore.ts` (+ test): record-at-approval hooks
  (approveAsset + quiz generation), `metricActual` per metric (email open documented
  as an opens-per-optin approximation — send counts are not ingested),
  `resolvePredictions`, `runCalibration` (lens samples from council reviews of
  resolved assets; state upsert with the report), `listPredictionsForProject`.
- `packages/pipeline/src/predictionsJobs.ts`: the two job handlers; worker registration.
- Web `predictions` router + page (forecast vs actual table, band hit coloring,
  resolve/calibrate-now, report display).

**Decisions:**
- **Bounds are enforced at WRITE and READ**: `computeCalibration` clamps what it
  stores, and `calibratedPrior` re-clamps whatever it reads — even a hand-corrupted
  state cannot push a prior past ±20%.
- **Floors are structurally out of reach** — calibration output has no floor field and
  the council config assembly never consults calibration for it.
- Email open rate resolves as opens/optins (approximation, documented in code): send
  counts don't exist in the ledger, and the optin list is the honest denominator we have.

**Open questions:** none blocking.

### WO-046 — Ledger dashboards

**Acceptance (restated):** Dashboards render per-project funnel by market_id
(traffic → quiz → optin → VSL retention curve → sale), control history timeline,
challenger queue with status, Brier/calibration trend, CSV export; dashboards render
from the fixture event stream and the retention curve matches raw quartile events.

**Done.** All aggregation is plain deterministic counting over the `events` table —
no sampling, no estimation. `projectFunnel` groups every event type by `market_id`
(null → "unattributed") and totals across markets; the retention curve inside each
funnel row counts vsl_quartile events at exactly 25/50/75/95, so by construction it
IS the raw event counts — the acceptance test seeds 60/45/30/12 quartile events and
asserts the curve equals `{starts:100, q25:60, q50:45, q75:30, q95:12}` verbatim.
`assetRetentionCurve` does the same per asset (cross-asset bleed tested).
`brierTrend` orders resolved forecasts by resolution time (ULID tiebreak) with a
running mean. `funnelCsv` emits a fixed column order with per-market rows plus a
TOTAL row; the test asserts the exact header and exact data lines.

**Files touched:**
- `packages/db/src/dashboards.ts` (+ test): `projectFunnel`, `assetRetentionCurve`,
  `brierTrend`, `funnelCsv`; exported from the package index.
- Web `dashboards` router (funnel with market labels, brierTrend, exportCsv) mounted
  in `_app.ts`; `/projects/[id]/dashboard` page + panel — funnel table with retention
  percentages, control timeline + challenger queue (composes the existing
  `controls.list` lineage/metrics), Brier trend table, Download CSV button
  (client-side blob from the deterministic server CSV).

**Decisions:**
- Control timeline and challenger queue REUSE `controls.list` (which already returns
  audit-derived lineage and arm metrics) rather than duplicating those queries in the
  dashboards router — one source of truth for control history.
- CSV labels markets as `<rank>. <label>`; unmapped events export as `unattributed`
  rather than being dropped, so exported totals always reconcile with the ledger.

**Open questions:** none blocking. Noted: one transient full-suite flake in the CLI
end-to-end build test (passed on isolation and on immediate full re-run; suspected
load-related timing in the fan-out fixture — watch on future full runs).

### WO-047 — Autopsy Mode

**Acceptance (restated):** Intake takes a funnel page by page (ad → landing → VSL
transcript → checkout), each URL-auto-fetched or pasted; Council-scored teardown with
persuasion sequence map, awareness/sophistication mismatch diagnosis, proof gap list,
offer critique, and ranked rewrite priorities; shareable public-token report with a
print view; "rebuild in CopyForge" CTA pre-filling Sales Detective. Acceptance:
end-to-end on a fixture funnel; public link read-only and revocable.

**Done.** End-to-end verified on the fixture rival-garage funnel: four pages in (one
via URL through the injected fetcher + readability extraction, persisted back so the
report and any rebuild work from the exact text analyzed), one `autopsy.run` job
through the pinned prompt at the seeded `autopsy` model stage, and the teardown must
parse against a hard zod contract before anything persists — all six Council lenses
scored with notes, ≥3 persuasion beats mapped in funnel order, awareness/sophistication
mismatch with diagnosis, severity-graded proof gaps, offer critique, and rewrite
priorities that must rank 1..n contiguously (a rank hole fails the job and marks the
autopsy failed with the reason). Public link: `shareAutopsy` mints `at_`+48hex
(stable across repeat shares, refused before completion), `/a/[token]` renders
title+report only — the read-only view's keys are asserted to be exactly
{title, report, createdAt} — and revocation nulls the token so the link 404s
immediately while the autopsy itself is untouched. Rebuild: creates
"Rebuild: <title>", queues the standard `intake.extract_profile` over
`autopsyToDumpText` (funnel pages in order + teardown findings), idempotent on
second click.

**Files touched:**
- `packages/core/src/autopsy.ts` (+ test): intake/report contracts,
  `orderAutopsyPages`, `parseAutopsyReport` (contiguous-rank rule),
  `autopsyToDumpText` (deterministic Sales Detective handoff).
- `packages/db/src/schema/autopsy.ts` + migration 0007: `autopsies` table
  (status, pages json, report json, unique nullable share_token,
  rebuilt_project_id); registered in TENANT_TABLES / TENANT_TABLE_NAMES /
  tenancy-scan / guard cross-tenant matrix.
- `packages/db/src/autopsyStore.ts` (+ test): CRUD, queue, share/revoke,
  `getAutopsyByShareToken` (public read-only view), `rebuildFromAutopsy`.
- `packages/pipeline/src/autopsy.ts` (+ test): the teardown job (URL auto-fetch →
  prompt → contract validation → persist; failure path stamps status+error).
- Seed: `autopsy.run` prompt (the `autopsy` model route already existed from WO-003).
- Web: `autopsy` router; `/autopsy` intake+list, `/autopsy/[id]` report with
  share/revoke/rebuild controls, PUBLIC `/a/[token]` (no auth, print stylesheet +
  Print/Save-as-PDF button, marketing CTA footer hidden in print);
  shared `AutopsyReportView` renderer used by both workspace and public views.

**Decisions:**
- The public view is assembled server-side from a whitelist (title/report/date) —
  page URLs, ids, and workspace never reach the shared page, so a leaked link
  exposes only the teardown itself.
- "PDF-style print view" = print stylesheet + window.print on the public page
  (browser Save-as-PDF), not a server PDF renderer — zero new dependencies,
  same output.
- Rebuild rides the EXISTING Sales Detective intake job rather than a bespoke
  pre-fill path — the autopsy dump is just a very good dump.

**Open questions:** none blocking.
