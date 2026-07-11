# CopyForge — Launch Checklist (WO-056)

Status legend: ✅ done & verified · 🔶 done, needs a human/production action · ⬜ open

## Hardening

- ✅ **Per-workspace API rate limit** — `RATE_LIMIT_RPM` (default 600/min) enforced in
  `workspaceProcedure` via a sliding-window limiter (`packages/core/src/rateLimit.ts`,
  unit-tested with an injected clock).
- ✅ **Job enqueue cap** — `JOB_ENQUEUE_CAP` (default 1000 pending/workspace) enforced
  inside `enqueueJob`; per-tenant, reopens as the queue drains (tested).
- ✅ **Input size caps on all public intakes** — every unauthenticated route reads its
  body through `readCappedJson` (128 KiB, 413 on excess): ingest adapters, quiz
  start/answer/complete, message-match impressions; Stripe webhook capped at 1 MiB.
  Authenticated intakes were already zod-capped (dump 200k chars, autopsy pages 60k,
  etc.).
- ✅ **Error reporting with verified key redaction** — minimal Sentry-compatible
  reporter (`packages/ai/src/errorReport.ts`); every field passes `redact()` before
  leaving the process; test proves an `sk-ant-…` key in message/stack/tags never
  reaches the payload. Wired into the worker's job-failure path. Console fallback
  when `SENTRY_DSN` is unset.
- 🔶 Set a real `SENTRY_DSN` in production env.

## Operations

- ✅ **MariaDB backup job** — `scripts/db-backup.sh` (single-transaction mysqldump,
  gzip, integrity check, retention prune). Cron line documented in the script.
- ✅ **Restore runbook executed on staging** — `scripts/db-restore.sh` restores into a
  verification database and checks core tables. Executed 2026-07-11 on staging:
  backup 4.3 MB → restored `copyforge_restore_check` → **54 tables, users=299,
  jobs=53, prompt_versions=151** — verified, then dropped.
- ✅ **Health endpoints for PM2** — web `GET /api/health` (200/503 on DB ping),
  worker `GET :WORKER_HEALTH_PORT/health` (default 8787). Both close cleanly on
  shutdown.
- 🔶 Point uptime monitoring at both endpoints in production.
- 🔶 Install the backup cron on the production host.

## Load test (acceptance)

- ✅ **20 concurrent workspace fan-outs** — `apps/worker/scripts/load-test.ts`
  (real queue + real worker loop; unrelated pending jobs shielded via the WO-052
  pause switch). Executed 2026-07-11 on staging:
  - 800/800 jobs completed (~187 jobs/s at concurrency 8)
  - **cross-tenant anomalies: 0** (every handler saw exactly its payload's workspace)
  - **fair scheduling intact**: all 20 workspaces appeared within the first 40
    claims; worst first-service position 35; per-workspace completions 40/40 min=max.

## Kill switches & flags (WO-052)

- ✅ `signups_enabled`, `harvester_enabled`, `worker_generation_enabled`,
  `paused_job_types` — all flip at runtime, no deploy (tested).

## Commercial spine

- ✅ Licensing & seats enforced structurally (WO-050); over-seat lockout + beta
  read-only degradation tested.
- ✅ Stripe billing replay-safe; refund grace; entitlement lapse ≤ 15 min (WO-051).
- 🔶 **Stripe test-mode click-through** — needs real `STRIPE_*` keys: create the
  $1,000 license price + $79/mo Genome Feed price, run checkout end-to-end with
  `stripe listen --forward-to /api/stripe/webhook`.
- ✅ Legal: ToS + privacy live; rights statement in ToS AND every export manifest;
  G6 disclaimer on every report (WO-055).

## Product sign-offs (carried user actions)

- 🔶 WO-038 live-model generation sign-off (one real-key build).
- 🔶 WO-042 UX walkthrough.
- 🔶 WO-054 human first-run walkthrough (mechanical path is test-verified).

## Pre-flight (production host)

- ⬜ `MASTER_KEY` generated and stored in the host secret store (never in git).
- ⬜ `DATABASE_URL` pointing at production MariaDB with a dedicated user.
- ⬜ `pnpm build && pnpm db:migrate && pnpm db:seed` on the host.
- ⬜ `pm2 start ecosystem.config.cjs` and both health endpoints green.
- ⬜ DNS + TLS in front of the web app; `APP_URL` set accordingly.
