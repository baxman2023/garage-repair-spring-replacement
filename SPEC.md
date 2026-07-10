# CopyForge — Codex Spec Package v1.0

**Working name:** CopyForge (alt: ControlForge — swap via `APP_NAME` env, no hardcoded strings).
**One-liner:** A multi-tenant persuasion system that interrogates an offer, selects the top 5 markets, generates a complete direct-response funnel per market (letters, VSLs, webinars, emails, ads, quiz funnel), gates every asset through a Council of legendary copywriter critics plus focus-group simulation, exports Page Build Packages (file + Macaly prompt + universal LLM prompt), and then closes the loop — ingesting real performance data to beat its own controls over time.
**Commercial model:** $1,000 lifetime license per user (seat-based workspaces), optional $79/mo "Genome Feed" subscription entitlement, BYO Anthropic API key (encrypted per workspace).
**Builder:** Claude Code. Execute work orders WO-001 → WO-056 in order. Phases are gated; do not start a phase until the prior phase's WOs are complete and green.

---

## 1. Stack & Conventions (LOCKED — do not deviate)

- Next.js 15 (App Router) · TypeScript `strict: true` · tRPC · Drizzle ORM · MariaDB
- PM2 process management, deployed on Cloudways (web + worker processes in one `ecosystem.config.cjs`)
- Anthropic Messages API with prompt caching (`cache_control` on stable system blocks). API docs: https://docs.claude.com/en/api/overview
- Workers: atomic job claim via `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction
- Headless pipeline CLI: `npm run produce -- <flags>`
- Spoken-script conventions (VSL, YouTube, webinar, short-form): 170 WPM timing basis, numbers spelled as words, NO stage directions, `scrubYears()` evergreening applied to all spoken output
- Every tenant-owned table carries `workspace_id`; every read/write passes through the tenancy guard (WO-004). No exceptions.
- No placeholder/stub code merged. Every WO ends with `tsc --noEmit` clean and `next build` passing.
- Secrets: `.env` validated at boot with zod (`src/env.ts`). User Anthropic keys are NEVER logged, echoed, or stored unencrypted.

### 1.1 Model routing defaults (config table `model_routes`, editable in admin)

| Stage | Default model | Notes |
|---|---|---|
| Classification, VOC extraction, claims extraction, scrubbers | `claude-haiku-4-5-20251001` | cheap, high volume |
| Asset drafting (all generators) | `claude-sonnet-4-6` | workhorse |
| Council critiques, Synthetic Focus Group, Autopsy, Offer Forge, Market Selection | `claude-fable-5` | deep strategic passes |
| Fallback chain | fable-5 → opus-4-8 → sonnet-4-6 | on 429/529 with backoff |

Model IDs live in config, never hardcoded in call sites. Per-workspace override allowed (BYO key = their cost).

### 1.2 Prompt caching architecture

Stable blocks marked with `cache_control: {type: "ephemeral"}`, ordered largest/most-stable first:
1. Council persona corpus (6 lens definitions + rubrics) — shared across all council calls
2. Persuasion Genome retrieval block (per niche, per component filter)
3. Market profile block (per market, stable across all assets in a fan-out)
4. Per-call dynamic user block (never cached)

Fan-out orchestration MUST order jobs to maximize cache hits (all assets for market 1, then market 2, ...). `usage_ledger` records `cache_read_input_tokens` vs `input_tokens` so cache hit rate is observable per project.

---

## 2. System Architecture

```
apps/
  web/        Next.js 15 app (UI + tRPC routers + quiz runtime routes + webhooks)
  worker/     Node worker (job claim loop, generators, gates, harvesters, ledger jobs)
  cli/        produce CLI (headless pipeline driver)
packages/
  db/         Drizzle schema + migrations + tenancy guard
  core/       pipeline domain logic (pure, testable): gates, scoring, contracts, prompts
  ai/         Anthropic client wrapper, model router, cache block builders, usage metering
```

### 2.1 Pipeline (gated DAG per project)

```
INTAKE (Sales Detective) ──► product_profile.json
   └─► G0 OFFER FORGE ──► strengthened offer
        └─► G1 FUNNEL MATH (hard stop; loop back to G0 on fail)
             └─► MARKET SELECTION ──► 5 × market_profile.json ──► G2 approval
                  └─► FAN-OUT ×5 markets × asset types
                       draft ─► G3 COUNCIL (≤3 revision loops)
                             ─► G4 FOCUS GROUP
                             ─► G5 DE-SLOP
                             ─► G6 COMPLIANCE
                             ─► G7 PACKAGE QA ─► Page Build Package (file + Macaly + universal LLM prompt)
                                                    └─► RUNTIME (quiz routing, message-match)
                                                         └─► CONTROL LEDGER (events in, Brier scoring,
                                                              challenger generation, promotion)
```

Statuses on `assets`: `draft → council → revising → focus_group → deslop → compliance → packaging → approved → live → retired`. Any gate failure sets `blocked` with a structured `gate_report`. Owner may `override` (audited).

### 2.2 Multi-tenancy & fairness

- `workspace_id` on every tenant table; composite indexes lead with it.
- Worker fair scheduling: claim query round-robins across workspaces with pending jobs (claim the oldest job of the least-recently-served workspace) so one user's 5-market fan-out cannot starve others.

---

## 3. Data Model (Drizzle / MariaDB) — canonical table list

Identity & commerce: `users`, `workspaces`, `workspace_members` (role: owner|member), `licenses` (key, status, seats), `seat_assignments`, `subscriptions` (genome_feed entitlement), `stripe_events`, `api_keys` (workspace_id, provider='anthropic', ciphertext, iv, tag, last4, verified_at), `usage_ledger` (workspace_id, project_id, job_id, model, input_tokens, cache_read_tokens, output_tokens, cost_est_usd), `audit_log`.

Strategy: `projects`, `product_profiles` (versioned JSON), `offers` (versioned), `funnel_math_runs`, `markets` (project_id, rank 1–5, profile JSON, awareness_stage enum, sophistication tinyint, resident_emotion), `voc_sources`, `voc_phrases` (market_id, phrase, kind: pain|desire|objection|identity, source_ref).

Genome: `swipes` (raw source, niche, channel, first_seen, last_seen, days_running), `genome_components` (swipe_id, type: lead|mechanism_name|proof_stack|price_reveal|close|bullet_style|headline_pattern, content JSON, tags), `genome_packs` (curated retrieval sets per niche).

Assets: `assets` (project_id, market_id, type enum, status, control boolean, prompt_version_id, current_version_id), `asset_versions` (blocks JSON, wordcount, readability_grade, created_by: system|user|challenger), `council_reviews` (asset_version_id, lens, score, verdict, notes JSON), `focus_group_runs` (annotations JSON, pass boolean), `claims` (asset_id, text, proof_ref, status: proven|flagged), `gate_reports` (asset_id, gate, pass, report JSON, overridden_by).

Delivery: `page_build_packages` (asset_id/market_id scope, package JSON, checksum), `exports` (format, path), `quiz_definitions` (project_id, questions JSON, scoring JSON, bands JSON), `quiz_sessions`, `quiz_answers`, `quiz_leads` (band, market_id routed, contact, disqualified boolean), `utm_variant_maps`.

Ledger: `events` (workspace_id, project_id, market_id nullable, asset_id nullable, type, value JSON, source: ringba|quiz|pixel|email|manual, occurred_at, dedupe_key unique), `controls` (project_id, market_id, asset_type, asset_id, since), `challengers` (control_id, asset_id, status: queued|live|won|lost), `predictions` (asset_id, metric, predicted, actual, brier, resolved_at), `calibration_state` (rubric weight adjustments JSON).

Infra: `jobs` (type, payload JSON, status: pending|claimed|done|failed, priority, workspace_id, run_after, attempts, claimed_by, heartbeat_at), `job_runs`, `prompt_versions` (name, version, body, active), `model_routes`, `feature_flags`.

Conventions: `id` = ULID char(26); `created_at`/`updated_at` on all tables; JSON columns are `json` type with zod schemas in `packages/core/contracts`.

---

## 4. JSON Contracts (zod in `packages/core/contracts`, versioned with `schema_version`)

**product_profile.json** — `{ schema_version, name, category, promise, mechanism { problem_mechanism, solution_mechanism, name }, origin_story, founder_voice_samples[], proof_assets[{type, ref, strength}], enemy, price { amount, model }, guarantees[], constraints { compliance_mode: none|health|finance, banned_claims[] }, prior_attempts[], links[] }`

**market_profile.json** — `{ schema_version, rank, label, avatar { age_range, identity, situation }, starving_crowd_scores { pain, purchasing_power, reachability, urgency, ltv, total }, awareness_stage: unaware|problem|solution|product|most, sophistication: 1-5, resident_emotion, core_desire, objections[], voc_corpus_ref, channels_ranked[], entry_conversation }`

**asset blocks** — every asset_version stores ordered blocks: `[{ id, role: headline|lead|story|mechanism|proof|bullets|offer|close|ps|subject|body|hook|cta|question, text, meta { timestamp_start?, timestamp_end?, open_loop?: true, variant_of? } }]`. VSL/webinar blocks carry 170-WPM-derived timestamps.

**page_build_package.json** — `{ schema_version, scope { project, market, asset }, copy_blocks[], design_brief { visual_hierarchy[], cta_choreography { sticky_cta_at, buy_reveal_at }, tone, section_map[] }, media { videoobject_schema, thumbnails_brief }, quiz_embed { snippet_ref } | null, message_match { utm_variants[] }, acceptance_criteria[], self_qa_checklist[], renderings { file_paths[], macaly_prompt, universal_llm_prompt } }`

**ledger event** — `{ type: page_view|vsl_quartile|quiz_start|quiz_complete|optin|call_start|call_qualified|sale|refund|email_open|email_click, value, market_id?, asset_id?, session_ref?, source, occurred_at, dedupe_key }`

---

## 5. Gate Definitions

| Gate | Name | Pass criteria (defaults in config, overridable per workspace) |
|---|---|---|
| G0 | Offer Forge | Offer has: quantified value stack, risk reversal, ≥1 legitimate urgency mechanism, price framing, name. User approves. |
| G1 | Funnel Math | Projected CPA ≤ allowable CPA at breakeven ROAS given price/margin and benchmark CVRs; else HARD STOP with routed fix list back to G0. Report always shown. |
| G2 | Market approval | 5 markets scored, profiles complete, user approved (may swap/edit before approval). |
| G3 | Council | Aggregate ≥ 80/100 AND no lens below 70. Max 3 revision loops, then escalate to user with lens notes. |
| G4 | Focus Group | ≥ 70% simulated cohort reaches CTA; no claim triggers disbelief spike ≥ 50% of cohort; annotations attached. |
| G5 | De-Slop | Flesch-Kincaid grade 5–7 (spoken) / 5–8 (written); zero AI-tell list hits; specificity density ≥ threshold; voice-match score ≥ threshold when samples provided. |
| G6 | Compliance | Claims inventory 100% proven-or-flagged; zero unresolved flags in health/finance mode; ad-policy lint clean or acknowledged. |
| G7 | Package QA | Package validates against contract; all renderings generated; self-QA checklist embedded; checksum recorded. |

---

## 6. Council of Copywriters (engine spec)

Six lenses, each a distinct cached persona block with a rubric. Each returns `{ score 0-100, verdict: pass|revise, top_fixes[≤3], line_notes[] }`.

| Lens | Dimension gated |
|---|---|
| Schwartz | Awareness/sophistication match: does the lead enter the conversation already in the prospect's head at the diagnosed stage? |
| Halbert | Emotional pull & A-pile energy: would the starving crowd feel this in the first 10 seconds? |
| Bencivenga | Proof density & believability: every claim carried by proof; bullets earn belief. |
| Sugarman | Slippery slide: each sentence forces the next; no friction points; readability rhythm. |
| Kennedy | Offer & close: stack clarity, urgency legitimacy (NO fake scarcity — flag it), CTA strength. |
| Carlton | Hook & lead: is the opening a genuine pattern interrupt with a real angle, not a warm-up? |

Aggregation in `packages/core/council.ts` (pure function). Revision prompts include only failing lenses' notes. `calibration_state` (WO-045) can adjust per-lens weights ±20% from ledger learning — never below floor thresholds.

---
## 7. Work Orders

Format per WO: **Objective / Deliverables / Acceptance.** Complete in order. One commit per WO: `WO-0XX: <title>`. Append entry to `WORKLOG.md` after each.

---

### PHASE 0 — Foundation (WO-001 … WO-008)

**WO-001 — Repo scaffold**
Objective: Monorepo per §2 with locked stack.
Deliverables: pnpm workspaces (`apps/web`, `apps/worker`, `apps/cli`, `packages/db|core|ai`); Next.js 15 App Router TS strict; tRPC wired; `src/env.ts` zod-validated env; `ecosystem.config.cjs` (web + worker); scripts: `dev`, `build`, `typecheck`, `lint`, `produce`, `worker`.
Acceptance: `pnpm typecheck` and `pnpm build` green from clean clone; PM2 config starts both processes locally.

**WO-002 — Schema v1 + migrations**
Objective: All §3 tables in Drizzle with migrations.
Deliverables: schema files per domain, ULID helper, `created_at/updated_at` triggers/defaults, composite indexes leading with `workspace_id`, seed script for `model_routes`, `prompt_versions`, `feature_flags`.
Acceptance: `drizzle-kit` migration applies cleanly to fresh MariaDB; seed runs idempotently.

**WO-003 — Auth (magic link) + workspaces**
Objective: Passwordless auth and workspace lifecycle.
Deliverables: magic-link email login (token table, 15-min expiry, single-use), session cookies (httpOnly), workspace create-on-first-login, roles owner|member, invite flow.
Acceptance: full login → workspace → invite → accept path works; sessions survive restart; expired/reused tokens rejected.

**WO-004 — Tenancy guard**
Objective: Make cross-tenant access structurally impossible.
Deliverables: `withWorkspace(ctx)` tRPC middleware injecting `workspace_id`; `packages/db/guard.ts` query helpers that require workspace scope; ESLint rule or CI grep forbidding raw `db.select` on tenant tables outside guard; tests attempting cross-tenant reads/writes.
Acceptance: cross-tenant test suite fails closed on every tenant table.

**WO-005 — BYO Anthropic key vault**
Objective: Encrypted per-workspace API keys.
Deliverables: AES-256-GCM encrypt/decrypt (`MASTER_KEY` env), store ciphertext+iv+tag+last4 only, "Test key" endpoint calling a 1-token Messages ping, key rotation, redaction middleware ensuring keys never appear in logs/errors.
Acceptance: key round-trips; logs verified key-free under forced error; workspace without valid key gets actionable error on any AI call.

**WO-006 — AI client wrapper + model router + usage metering**
Objective: Single choke point for all Anthropic calls.
Deliverables: `packages/ai/client.ts` — resolves workspace key, resolves model via `model_routes` (stage → model, fallback chain on 429/529 with exponential backoff + jitter), builds cache_control block stacks per §1.2, records `usage_ledger` row per call (tokens, cache reads, cost estimate from config price table), request timeout + max_tokens per stage config.
Acceptance: unit tests with mocked API cover routing, fallback, metering; no call site outside `packages/ai` constructs a raw Anthropic request.

**WO-007 — Job queue + fair scheduler**
Objective: Durable multi-tenant work execution.
Deliverables: claim loop using `FOR UPDATE SKIP LOCKED`; round-robin fairness (least-recently-served workspace first); heartbeat + stale-claim reaper; retries with backoff, max attempts → `failed` with error JSON; `job_runs` audit; graceful shutdown; worker concurrency env-tunable.
Acceptance: fairness test — workspace A enqueues 100 jobs, B enqueues 2, B's complete within first scheduling window; crash mid-job is reclaimed exactly once.

**WO-008 — Prompt registry + pinning**
Objective: Versioned prompts; assets never silently change.
Deliverables: `prompt_versions` CRUD (admin-only), loader `getPrompt(name)` returning active version, `asset_versions.prompt_version_id` recorded at generation, regen honors pinned version unless user opts into "upgrade to latest", diff view between versions.
Acceptance: bumping a prompt version does not alter regeneration of an existing asset unless explicitly upgraded.

---

### PHASE 1 — Intake & Strategy (WO-009 … WO-016)

**WO-009 — Sales Detective intake**
Objective: Produce `product_profile.json` from dump or interrogation.
Deliverables: Dump mode (paste text, URLs — fetch worker with readability extraction, file upload txt/md); Interrogation mode — adaptive question flow (origin story, mechanism, proof assets, enemy, price, prior attempts, compliance mode, founder voice samples); profile editor UI; versioned save.
Acceptance: both modes emit contract-valid profiles; interrogation asks only unanswered fields; URLs ingested via worker job.

**WO-010 — Offer Forge (G0)**
Objective: Diagnose and strengthen the offer before any copy.
Deliverables: fable-5 pass producing offer diagnosis + 3 strengthened variants (value stack w/ assigned values, risk reversal options, legitimate urgency mechanisms, price framing, offer name candidates); side-by-side picker; selected offer versioned to `offers`; G0 recorded.
Acceptance: cannot advance without approved offer meeting G0 checklist; fake-scarcity suggestions are structurally excluded from prompts.

**WO-011 — Funnel Math (G1)**
Objective: Kill uneconomic funnels before generation.
Deliverables: inputs (price, margin, refund est., channel CPC estimates, benchmark CVR table in config), outputs (allowable CPA, breakeven ROAS, projected CPA per channel, required LTV), pass/fail vs thresholds, HARD STOP with ranked fix list routing back to WO-010, printable report.
Acceptance: math covered by unit tests incl. edge cases; failing project cannot enqueue generation jobs.

**WO-012 — Market Selection Engine**
Objective: Generate + score candidate markets, pick top 5.
Deliverables: fable-5 candidate generation (8–12), starving-crowd scoring matrix (pain, purchasing power, reachability, urgency, LTV — weights in config), ranked list UI with swap/edit/add-manual, persist top 5 to `markets` rank 1–5.
Acceptance: scores persisted with rationale text per market; user edits survive re-runs.

**WO-013 — Market profiles (Schwartz diagnosis)**
Objective: Full `market_profile.json` per selected market.
Deliverables: awareness stage + sophistication level with one-line justification each, resident emotion, avatar, objections (≥5), entry_conversation (the sentence already running in their head), channels ranked; profile editor.
Acceptance: 5 contract-valid profiles; diagnosis fields non-empty and referenced later by generators (assert in G3 prompt inputs).

**WO-014 — VOC miner**
Objective: Voice-of-customer corpus per market from user-supplied sources.
Deliverables: source intake (paste blobs, URLs: reviews/threads/comments), haiku extraction pipeline → `voc_phrases` typed pain|desire|objection|identity with source refs, dedupe, per-market corpus viewer, corpus injected into generation cache blocks.
Acceptance: 200-phrase corpus builds < 2 min on worker; phrases traceable to sources; generators demonstrably quote VOC (spot-check harness).

**WO-015 — Strategy Review (G2)**
Objective: Human approval checkpoint.
Deliverables: side-by-side 5-market review screen (scores, diagnosis, VOC highlights), approve/regenerate per market, G2 record with snapshot hash.
Acceptance: fan-out unreachable until G2 approved; approval snapshot immutable.

**WO-016 — produce CLI v1**
Objective: Headless strategy phase.
Deliverables: `npm run produce -- --project <id> --phase strategy [--auto-approve]` runs WO-009-input→WO-013 outputs where possible, JSON summary to stdout, non-zero exit on gate failure.
Acceptance: CI-runnable against seeded fixture project.

---

### PHASE 2 — Genome & Generation (WO-017 … WO-028)

**WO-017 — Persuasion Genome: schema + decomposer**
Objective: Swipes stored as tagged structural components, not blobs.
Deliverables: swipe intake (paste/URL), sonnet decomposition into `genome_components` (lead type, mechanism naming pattern, proof stack sequence, price-reveal choreography, close type, bullet style, headline pattern) with confidence + tags (niche, channel, awareness).
Acceptance: 10-swipe fixture decomposes with ≥90% components typed; components queryable by type+niche.

**WO-018 — Genome retrieval + seed corpus**
Objective: Retrieval feeding generation.
Deliverables: `genome_packs` curated per niche, retrieval fn (filters: component type, niche, awareness, channel; recency-weighted), rendered as cached block per §1.2, seed loader for owner-provided corpus files in `/seed/genome`.
Acceptance: retrieval deterministic given seed; cache block ≤ configured token budget with graceful truncation by weight.

**WO-019 — Meta Ad Library harvester (manual-trigger v1)**
Objective: Live winners into the genome.
Deliverables: per-niche saved queries, worker fetch of Ad Library results, filter ads running ≥90 days, store to `swipes` (first_seen/last_seen/days_running) → auto-decompose via WO-017; ToS-respecting rate limits; if fetch blocked, degrade to guided manual paste flow with same downstream path. Genome Feed entitlement flag gates scheduled runs (WO-051).
Acceptance: harvest run persists ≥N swipes on a test niche or cleanly reports degradation; nothing scheduled without entitlement.

**WO-020 — Council engine (G3)**
Objective: Six-lens critique with revision loop.
Deliverables: cached persona blocks + rubrics per §6, parallel lens calls (fable-5), aggregate in pure `council.ts`, verdict persistence to `council_reviews`, revision prompt composed ONLY from failing lenses, loop max 3 then escalate with notes UI, per-asset council report view.
Acceptance: fixture bad-draft fails, improves across loops on record; thresholds config-driven; aggregate math unit-tested.

**WO-021 — Asset framework**
Objective: Block-structured assets with status machine.
Deliverables: `assets`/`asset_versions` per §3–§4, status transitions enforced in one module, block editor UI (edit/reorder/lock blocks; locked blocks survive regeneration), version diff view, regenerate-single-block action.
Acceptance: illegal transitions rejected; block lock honored across regen; diff renders adds/removes/edits.

**WO-022 — Generator: long-form sales letter**
Objective: Full letter per market.
Deliverables: structure selector (PAS | star-story-solution | 4Ps), Bencivenga bullet engine (fascination bullets from VOC + proof), mechanism section using profile mechanism names, offer/close blocks from approved offer, target lengths config; consumes market cache block + genome block.
Acceptance: contract-valid blocks; every claim registered to `claims`; enters G3 automatically.

**WO-023 — Generator: VSL script**
Objective: Retention-engineered VSL, 8–20 min target.
Deliverables: RMBC construction; THREE lead variants per market (story | big promise | secret); 170-WPM timestamping per block; retention map — predicted drop-off points with an open-loop block planted immediately before each; promise verbalized inside first 30 seconds (assert); numbers-as-words + no stage directions + `scrubYears()` enforced by post-processor; retention map stored in blocks meta and rendered beside script.
Acceptance: post-processor tests (digits→words, stage-direction strip, year scrub); duration calc within ±5% of wordcount/170; 3 variants persisted as sibling versions.

**WO-024 — Generator: short-form feeder hooks**
Objective: Top-of-funnel vertical scripts feeding the VSL.
Deliverables: 3 × ~30-second scripts per market (pattern-interrupt hook ≤3s, mechanism tease, curiosity CTA to VSL), same spoken-script post-processor, linked to parent VSL variant.
Acceptance: each ≤ 90 words spoken; hook block flagged and first; CTA references VSL slug.

**WO-025 — Generator: webinar**
Objective: Perfect-Webinar-skeleton presentation script.
Deliverables: big domino statement, 3 secrets (vehicle/internal/external belief breaks), stack & close with approved offer, registration-page copy + reminder email stubs (24h/1h/15m) + replay email, timestamped at 170 WPM.
Acceptance: skeleton sections present and ordered; stack mirrors offer value stack line-for-line.

**WO-026 — Generator: email sequences**
Objective: Owned-audience engine per market.
Deliverables: indoctrination/welcome (5–7), launch seed→open→close (9), cart abandon (3), 10 daily-infotainment templates in founder voice; subject + preview + body blocks; merge-field conventions documented; every email single-CTA.
Acceptance: sequence graphs persisted with send-offset metadata; subjects pass G5 AI-tell scrub.

**WO-027 — Generator: ads + advertorial**
Objective: Paid-traffic entry assets.
Deliverables: Meta — 5 primary texts + 10 headlines + 5 descriptions per market, angle-tagged; YouTube in-stream script (hook ≤5s, 60–90s, spoken conventions); native headline/teaser sets (10); full advertorial presell page (story-led, disguised-ad disclosure block included); each ad tagged to the VSL/letter lead it message-matches (feeds WO-041).
Acceptance: counts met; disclosure block present on advertorial; angle tags persisted.

**WO-028 — Fan-out orchestrator + upsell/bump generator**
Objective: One click → full 5-market build, resumable.
Deliverables: job graph builder (per-market ordered chains to maximize cache hits per §1.2), progress UI (per market × asset grid with statuses), resume-from-failure, cancel; upsell + order-bump copy generator appended to chain; single "Build All" action post-G2.
Acceptance: kill worker mid-build → resume completes without duplicates; cache hit rate visible ≥ target on second market onward.

---

### PHASE 3 — Quality Gates (WO-029 … WO-034)

**WO-029 — Synthetic Focus Group (G4)**
Objective: Simulated cold-traffic read/watch before spend.
Deliverables: sample 20 personas from market profile (vary skepticism/awareness within band), simulate consumption (fable-5, batched), collect per-persona: attention-drop block, disbelief-spike claims, bounce reason, "spouse test" quote; aggregate report + marked-up draft (annotations anchored to block ids); G4 thresholds per §5; one-click "fix annotations" revision pass.
Acceptance: annotations anchor to real block ids; thresholds config-driven; report exportable.

**WO-030 — De-Slop Gate (G5)**
Objective: Output indistinguishable from a hired A-lister.
Deliverables: voice capture from founder samples (style card), readability measure + targeted rewrite loop to grade band, specificity injector (numbers, names, sensory detail — sourced from profile/VOC only, never invented), sentence-rhythm variance pass, AI-tell scrubber (config list: em-dash overuse, "delve", "navigate the complexities", etc.), voice-match score.
Acceptance: fixture sloppy draft exits within grade band, zero tell hits; injector cannot introduce claims absent from `claims`/profile (test).

**WO-031 — Claims inventory**
Objective: Every claim proven or flagged.
Deliverables: haiku claim extraction per asset version → `claims`, proof linker UI (attach proof_assets), status proven|flagged, flag report per asset.
Acceptance: G6 blocked while unresolved flags exist in strict modes; claims survive regeneration via text-similarity rematch.

**WO-032 — Compliance pre-flight (G6)**
Objective: Copy that keeps ad accounts alive.
Deliverables: rule packs — FTC (testimonials/endorsements, earnings), health mode (no disease claims list), finance mode (earnings disclaimers required), Meta/Google ad-policy lint (personal attributes, before/after, sensational); per-asset report with line refs; required-disclaimer inserter; acknowledge-with-audit path for lint warnings (never for strict-mode claim failures).
Acceptance: rule packs unit-tested with fixture violations; strict modes fail closed.

**WO-033 — Gate dashboard**
Objective: Single control surface.
Deliverables: project view of market × asset grid with G3–G7 states, block/approve/override (owner-only, audited with reason), gate report drill-ins, bulk actions.
Acceptance: override writes `audit_log` + `gate_reports.overridden_by`; grid reflects live worker updates.

**WO-034 — produce CLI v2**
Objective: Headless full build + gates.
Deliverables: `npm run produce -- --project <id> --phase build [--markets 1,2] [--assets vsl,email]`, streams progress, JSON summary (per-asset gate outcomes), non-zero exit on any blocked asset.
Acceptance: fixture project builds end-to-end headless in CI (mocked AI), summary schema stable.

---

### PHASE 4 — Export & Runtime (WO-035 … WO-042)

**WO-035 — Page Build Package composer (G7)**
Objective: The deliverable-of-deliverables per §4 contract.
Deliverables: composer assembling copy_blocks + design brief (visual hierarchy mapped to persuasion sequence; CTA choreography — sticky CTA timing, buy-button reveal keyed to VSL timestamp or letter block), VideoObject JSON-LD for VSL pages, quiz embed ref, message-match variant map, acceptance_criteria + self_qa_checklist generation; contract validation + checksum; G7 record.
Acceptance: package validates; checksum stable across identical inputs; missing renderings block G7.

**WO-036 — Export renderer (files)**
Objective: Clean file artifacts.
Deliverables: per-asset exports — Markdown always; HTML (semantic, unstyled-clean) for letters/advertorials/quiz results; VSL/webinar teleprompter TXT (170 WPM block timing header); email sequence as .md pack; per-market ZIP; export history.
Acceptance: exports byte-reproducible from a package; ZIP contains manifest.json listing checksums.

**WO-037 — Macaly prompt compiler**
Objective: Package → one-shot Macaly build prompt.
Deliverables: template (versioned in prompt registry) rendering: page goal, section-by-section copy injection verbatim (marked DO-NOT-REWRITE), design brief directives, mobile-first + load-speed directives, VideoObject/schema embed instructions, quiz embed snippet, form/CTA wiring, final self-check list; copy-to-clipboard UI.
Acceptance: prompt contains 100% of copy blocks verbatim (assert), ≤ Macaly practical length budget (config) with overflow strategy (split into build + refine prompts).

**WO-038 — Universal LLM prompt compiler**
Objective: Model-agnostic "build this page" prompt.
Deliverables: template producing: role framing, full package payload, tech constraints (single-file HTML or user-selected stack), explicit acceptance criteria, self-QA checklist the model must verify line-by-line before declaring done, instruction to output complete code with zero placeholders; variant flags `--stack single-html|nextjs`.
Acceptance: prompt tested against a live model on one fixture package produces a rendering that passes its own checklist (manual sign-off ok).

**WO-039 — Quiz builder**
Objective: Quiz = runtime market router + prequalifier.
Deliverables: generator producing 5–8 questions engineered to sort respondents into the 5 market buckets (each option weight-mapped to markets), plus prequal questions (budget/urgency) with disqualification logic, weighted scoring, score bands, per-band results-page copy (band page = that market's short-form letter + CTA), lead-capture step placed between last question and results, editor UI for questions/weights/bands.
Acceptance: routing simulator — 1,000 synthetic answer sets distribute to expected buckets; disqualified path renders decline-with-dignity page and is tagged.

**WO-040 — Quiz runtime**
Objective: Deployable quiz that captures and routes.
Deliverables: (a) hosted Next.js route `/q/[slug]` — one question per screen, progress bar, mobile-first, fast; (b) embeddable SINGLE-FILE HTML export (self-contained, posts to hosted API); `quiz_sessions/answers/leads` persistence; routed redirect or inline render of market-variant results; CRM webhook out (configurable URL, payload = lead + band + answers); ledger events emitted (quiz_start/complete/optin).
Acceptance: single-file export runs from `file://` and third-party pages; session funnel metrics recorded; webhook retries with backoff.

**WO-041 — Message-match runtime**
Objective: Ad → page congruence, automated.
Deliverables: `utm_variant_maps` linking utm_content/campaign → headline+lead variant (auto-seeded from WO-027 ad↔lead tags), drop-in JS snippet + hosted middleware performing swap without layout shift, congruence report (ads with no mapped variant flagged), variant impressions logged to ledger.
Acceptance: swap under 50ms after first paint in test page; unmapped UTM falls back to control cleanly.

**WO-042 — Delivery Center**
Objective: One place to take everything to market.
Deliverables: per-project browse of packages/exports/prompts, copy buttons, regenerate-single-block, per-market ZIP download, quiz links + embed codes, message-match snippet, "what to do next" checklist per asset.
Acceptance: a new user can go from approved build → live-ready files/prompts without touching another screen.

---

### PHASE 5 — Control Ledger & Autopsy (WO-043 … WO-049)

**WO-043 — Event ingestion**
Objective: Reality flows in.
Deliverables: `events` per §4 with dedupe_key uniqueness; adapters — Ringba webhook (call_start/qualified, campaign→market_id map UI), native quiz events (WO-040), generic pixel + webhook (page_view, vsl_quartile 25/50/75/95, optin, sale, refund), email metrics CSV import; per-project ingest keys; replay-safe.
Acceptance: duplicate deliveries collapse; fixture streams populate dashboards; unmapped events land in triage queue, not dropped.

**WO-044 — Controls & challengers**
Objective: "Beat the control" as a system behavior.
Deliverables: control designation per (project, market, asset_type) — first approved asset auto-control; challenger creation (from Council escalation notes, focus-group annotations, or ledger weak points); challenger lifecycle queued→live→won|lost; promotion rule — min sample size AND uplift beyond significance heuristic (config; document the heuristic honestly as directional, not lab-grade); promotion swaps control with full history retained.
Acceptance: promotion impossible below min volume; history immutable; UI shows control lineage.

**WO-045 — Predictions & Brier scoring**
Objective: The system learns whether it can trust itself.
Deliverables: at approval, record predictions (quiz optin rate, VSL 50% retention, letter CVR, email open) with probability bands; resolver job matches actuals from ledger at volume thresholds; Brier score per prediction; calibration job adjusts `calibration_state` (Council lens weights ±20% cap, prediction priors) — floors from §6 never lowered; calibration report.
Acceptance: Brier math unit-tested; calibration provably bounded; predictions display alongside actuals per asset.

**WO-046 — Ledger dashboards**
Objective: See the machine work.
Deliverables: per-project funnel by market_id (traffic → quiz → optin → VSL retention curve → sale), control history timeline, challenger queue with status, Brier/calibration trend, export CSV.
Acceptance: dashboards render from fixture event stream; retention curve matches raw quartile events.

**WO-047 — Autopsy Mode**
Objective: Teardown any funnel; flagship lead magnet.
Deliverables: intake (URLs auto-fetched or pasted content per page: ad → landing → VSL transcript → checkout), Council-scored teardown — persuasion sequence map, awareness/sophistication mismatch diagnosis, proof gap list, offer critique, ranked rewrite priorities; shareable report (public token URL + PDF-style print view); "rebuild in CopyForge" CTA that pre-fills Sales Detective from the autopsy.
Acceptance: end-to-end on a fixture funnel; public link read-only and revocable.

**WO-048 — Learning loop**
Objective: The genome eats winners.
Deliverables: nightly job — promoted challengers + high-Brier-accuracy assets decomposed into `genome_components` (tagged internal-winner), calibration refresh, Genome Feed pack refresh for entitled workspaces; internal winners NEVER leak across workspaces (workspace-scoped genome layer over the shared seed corpus).
Acceptance: cross-workspace leak test fails closed; nightly run idempotent.

**WO-049 — produce CLI v3**
Objective: Ledger-driven challenger batches, headless.
Deliverables: `npm run produce -- --project <id> --phase challenge [--target vsl@market2]` reads ledger weak points, generates challenger set through full gates, outputs summary.
Acceptance: runs in CI with mocked AI + fixture ledger; challengers land queued.

---

### PHASE 6 — Commercial Spine (WO-050 … WO-056)

**WO-050 — Licensing & seats**
Objective: $1,000/user enforced structurally.
Deliverables: license keys (issue/activate/revoke), seat model — named users per workspace, seat count on license, assignment UI, over-seat lockout with clear upsell message, Forge Vault beta flag (license type `beta` w/ expiry).
Acceptance: seat 3 on a 2-seat license cannot authenticate into workspace; beta expiry downgrades gracefully (read-only).

**WO-051 — Stripe billing**
Objective: Money in, entitlements on.
Deliverables: Checkout — $1,000 lifetime license product (quantity = seats); optional Genome Feed subscription $79/mo → entitlement flag consumed by WO-019/048; webhook handler (idempotent via `stripe_events`), refund → license revoke flow with grace period, receipts/invoices surfaced in app.
Acceptance: full purchase → activation path in Stripe test mode; webhook replay-safe; subscription lapse flips entitlement within a day.

**WO-052 — Admin panel**
Objective: Operate the business.
Deliverables: (platform-owner role, separate auth guard) users/workspaces/licenses search, prompt registry management, model_routes editor, feature flags, kill switches (pause worker types, disable harvester, disable signups), usage overview across workspaces (counts + token totals, never content).
Acceptance: admin routes inaccessible to normal owners; kill switches take effect without deploy.

**WO-053 — Usage & cost dashboard (user-facing)**
Objective: BYO-key transparency.
Deliverables: per-workspace and per-project token/cost views from `usage_ledger`, cache-hit-rate display, per-build cost estimate BEFORE running fan-out (based on config averages), monthly summary.
Acceptance: pre-build estimate within ±30% of actual on fixture build; dashboard sums reconcile with ledger.

**WO-054 — Onboarding: "First Funnel Today"**
Objective: The first hour decides refunds.
Deliverables: guided first-run — Sales Detective doubles as onboarding, progress checklist (profile → offer → math → markets → build → delivery), sample demo project (read-only) showing a finished 5-market build, contextual docs pages (MDX), empty states everywhere point to next action.
Acceptance: new user reaches an approved strategy (G2) following only on-screen guidance on a fixture product.

**WO-055 — Legal & rights**
Objective: Set expectations at this price.
Deliverables: Terms of Service incl. BYO-key terms (their key, their cost, our encryption duty), explicit commercial-rights statement — buyer owns generated copy outright, no watermarks anywhere in exports; privacy policy; compliance-tool disclaimer (assistive, not legal advice) surfaced on G6 reports; footer/links wired.
Acceptance: rights statement appears in ToS AND in every export ZIP manifest.

**WO-056 — Hardening & launch checklist**
Objective: Survive launch week.
Deliverables: rate limits (per-workspace API + job enqueue caps), input size caps on all intakes, error reporting (Sentry or equivalent) with key-redaction verified, MariaDB backup job + restore runbook, load test — 20 concurrent workspace fan-outs on staging, uptime/health endpoints for PM2, `LAUNCH_CHECKLIST.md` completed.
Acceptance: load test completes with fair scheduling intact and zero cross-tenant anomalies; restore runbook executed once successfully on staging.

---

## 8. Build Order & Definition of Done

- Phases strictly sequential: 0 → 1 → 2 → 3 → 4 → 5 → 6. WOs within a phase sequential unless a WO explicitly notes independence.
- Per-WO DoD: acceptance criteria demonstrably met · `pnpm typecheck` + `pnpm build` green · new logic unit-tested where the WO names tests · `WORKLOG.md` entry (WO id, files touched, decisions, open questions) · single commit `WO-0XX: <title>`.
- Per-phase DoD: phase report in `WORKLOG.md` summarizing state, risks, and any spec deviations proposed (deviations require explicit human approval BEFORE implementation).
- Mocked-AI test harness (`packages/ai/mock.ts`) required from WO-006 so CI never spends tokens.

## 9. Environment

`DATABASE_URL` · `MASTER_KEY` (32-byte, key vault) · `APP_NAME` · `APP_URL` · `EMAIL_*` (magic link transport) · `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / price IDs · `SENTRY_DSN` · `WORKER_CONCURRENCY` · `NODE_ENV`. No `ANTHROPIC_API_KEY` at platform level in production paths — user keys only (a `DEV_ANTHROPIC_KEY` may exist for local dev/seed only, guarded by `NODE_ENV !== 'production'`).

## 10. Known Risks (build honestly around these)

1. **Ad Library harvesting fragility** — WO-019 must degrade to manual paste without breaking the genome path.
2. **Token cost surprise** — WO-053 pre-build estimates are mandatory before any fan-out button.
3. **Significance theater** — WO-044's promotion heuristic must be documented as directional; never claim lab-grade stats in UI copy.
4. **Compliance overreach** — G6 is assistive lint, not legal advice; disclaim per WO-055.
5. **Prompt drift vs Control Ledger** — pinning (WO-008) is load-bearing; treat any unpinned generation path as a bug.

— End of spec. Begin with Phase 0, WO-001. —
