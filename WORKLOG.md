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
