---
tags: [log, append-only]
---

# Incident & Decisions Log

Append-only. Add an entry every time a non-obvious decision is made or an incident happens — as it happens, not retroactively. Newest at top.

---

## 2026-09-18 — Real end-to-end run (backend over real HTTP, labour app in a real browser): four more bugs found and fixed

Ran the actual backend (`npm run dev`, port 3001 — 3000 was occupied by an unrelated local service) against the Neon `production` branch, and the labour app (`npm run dev`) pointed at it, then drove the real backend via `curl` and the real labour app UI via a Chrome browser (`claude-in-chrome` MCP tools). Seeded real `admin`/`labour1`/`labour2` accounts, since none existed. Full account in [[08-testing-log]].

- **Backend over real HTTP (curl):** login, multipart demand upload, FSN list, lock acquire/conflict (409 with holder name)/darkstore-list-blocked-even-direct (403), partial batch submit, idempotent retry (`duplicate`), over-batch rejection, release, re-acquire by a second labourer, admin force-unlock and locks view, demand-batches list — all matched the documented contract exactly. No bugs at this layer.
- **Labour app in a real browser — three bugs found, none catchable by curl or the service-level integration tests, all fixed:**
  1. Backend had **no CORS configuration at all** — every cross-origin browser request failed preflight. Added `@fastify/cors`, configurable via a new `CORS_ORIGINS` env var.
  2. `labour-app`'s API client always sent `Content-Type: application/json` even on bodyless POSTs (lock/heartbeat/release), which Fastify's JSON body parser rejects outright. Fixed to only set the header when there's an actual body.
  3. `lockService.ts`'s acquire UPSERT's `WHERE expires_at < now()` didn't account for the requester already holding the lock — a retried acquire from the *same* labourer (which the offline-queue design explicitly anticipates) incorrectly 409'd against itself. Reproduced live, by accident, via a React dev-mode double-effect invocation. Fixed: `WHERE expires_at < now() OR labour_id = $2`; added a regression test, passing against the disposable `test` branch (19/19 now). Updated the matching SQL in [[02-adr-001-fsn-level-locking]] and [[03-data-model]].
- **A fourth bug, same session:** a full page reload always bounced to `/login` even with a valid stored session, because `AuthProvider` restored from `localStorage` inside a `useEffect` (runs after first render) rather than synchronously — `ProtectedRoute` saw `user: null` on that first render and redirected before the effect ran. Matters specifically for this app's target devices (shared phones on flaky networks, where reloads/restarts are routine). Fixed by restoring in `useState`'s initializer instead.
- **After all four fixes**, verified live: session persists across a full reload; lock conflict/self-reacquire/release all behave correctly; partial-entry batching submits only touched rows and leaves others untouched; the three-way Submit & exit / Discard & exit / Cancel dialog appears with the right count; Discard & exit navigates back *and* genuinely releases the lock server-side (checked via direct DB query, not just the UI).
- **Data note:** this session's seed accounts and uploaded demand batch are real rows in the Neon `production` branch, not the disposable `test` branch — flagged to the project owner, not yet cleaned up as of this writing.

## 2026-09-18 — Neon project connected; real migrations run; two production-correctness bugs found and fixed

- Neon project `sweet-frog-87532306` (Ninjacart-WMS, org `org-gentle-base-26380712`) set up via the `neon` CLI and linked to this directory, on the `production` branch. Neon skills + a project-scoped MCP server (key limited to this one project, cannot touch any other project or mint keys — see below) installed for Claude Code.
- Ran the 7 backend migrations against `production` for the first time — all applied cleanly. Verified the most recent down-migration actually works (dropped and re-applied `batching_events`) before moving on, per the "migrations must be reversible" rule in `CLAUDE.md`.
- Created a disposable `test` branch (`br-silent-heart-b5updgpc`) off `production` for integration tests, so synthetic test data never touches the real branch. Documented in `backend/README.md` — get its connection string on demand via `neon connection-string test --project-id sweet-frog-87532306`, never commit it.
- **Running the integration test suite against this real branch for the first time caught two genuine bugs that lint/typecheck/build/unit-tests never could:**
  1. `ledgerService.ts`'s atomic check-then-insert combined `FOR UPDATE` with `GROUP BY` — Postgres rejects this outright, so every batch submission was broken. Fixed by locking the `demand` row first, then summing `batching_events` as a second statement in the same transaction (still fully atomic — see updated comment in the code).
  2. `ingestionService.ts` inserted rows one at a time in a loop, which timed out over real network latency on a 15-row test file — and would have been genuinely slow on a real multi-hundred-row demand file too, not just a test artifact. Fixed with one batched `INSERT ... SELECT ... FROM unnest(...)` per table.
  3. (Test-only, not a service bug) `lockService.integration.test.ts` shared one FSN across two tests without releasing at the end of the first, causing the second test's first call to throw instead of its second as intended. Fixed by giving each test its own FSN.
- This is exactly the scenario `docs/01-architecture.md` and prior log entries kept flagging as "not yet verified against a real DB" — worth remembering next time something looks done because it compiles and unit-tests pass.
- Scoping note: when asked to run `neon mcp -y` per its literal default, flagged that the default mints an **account-wide** API key (all projects, all categories, write access, global config) and suggested `--project --project-id <id>` instead. Confirmed with the project owner and ran it scoped — the minted key (id `3346185`) can only touch this one project.

## 2026-09-18 — Infra decision: stay on Neon/Railway for now, documented with a real cost/reliability comparison

- Compared Neon+Railway against AWS (Aurora/RDS + Fargate) and GCP (Cloud SQL Enterprise Plus + Cloud Run) on SLA (99.95% vs 99.99%+ on the AWS/GCP HA tiers), rough monthly cost (~$250–450 for Neon/Railway vs ~$450–600+ for AWS, driven mainly by Multi-AZ doubling the DB instance cost, vs ~$250–400 for GCP), and operational complexity. Full writeup: [[07-infrastructure-cost-and-migration]].
- **Decision: keep Neon + Railway for now.** Reasoning: nothing in the codebase is locked into either provider (raw SQL/no ORM, no vendor SDK calls, env-var-driven config) so the switching cost stays low; the operational simplicity is worth more than the SLA gap while the system is still being built and hasn't been load-tested. Revisit before production go-live at full volume, or once real load-test numbers exist.
- Added `backend/Dockerfile` as a migration hedge (Railway doesn't require one today; AWS Fargate/GCP Cloud Run would). **Not verified with a real `docker build`** — no Docker available in this environment; verify before actually deploying to a container platform.

## 2026-09-18 — Labour PWA built; dummy ingestion schema fixtures added

- `labour-app/`: React + Vite + Tailwind, installable PWA. Implements the full flow in [[00-overview]] — FSN list → lock acquire (gates the darkstore list per [[02-adr-001-fsn-level-locking]]) → partial-entry batching with a local draft cache keyed by `(fsn, darkstoreId)` → submit-only-touched-rows → the three-way Submit/Discard/Cancel exit dialog.
- Offline queue (IndexedDB via `idb`): every heartbeat/release/batch action is queued before the network call and retried with the same idempotency key on reconnect. **Lock acquire is a deliberate exception** — it still goes through the queue for audit consistency, but the UI waits for a definitive synced/rejected outcome before opening the darkstore list, rather than trusting an optimistic guess. Documented in `labour-app/README.md`.
- **Scope trims flagged, not hidden:** "back navigation" is the app's own header button, not native browser/gesture back-button interception; PWA icons are placeholder solid colors, not real artwork; nothing has been run against a live backend yet (no Neon connection was available while this was built).
- Ingestion dummy schema (`FSN,Darkstore,QtyRequired`) turned into concrete test fixtures (`backend/test/fixtures/`) covering clean/mostly-valid/majority-invalid files, wired into a new integration test. Real headers still pending confirmation from the external source — see [[04-ingestion-contract]].

## 2026-09-18 — Backend core built (schema, locking, ledger, ingestion)

- `backend/` scaffolded: Fastify + TypeScript + `pg`, 7 reversible migrations covering the full schema in [[03-data-model]].
- ADR-001's lock mechanism ([[02-adr-001-fsn-level-locking]]) implemented as a single atomic `INSERT ... ON CONFLICT ... WHERE expires_at < now()` in `lockService.ts`, fully audited via `fsn_lock_events`; a server-side `lockGuard.ts` enforces that only the current lock holder can open a locked FSN's darkstore list or submit against it.
- Ledger writes (`ledgerService.ts`) implement the atomic check-then-insert independently of lock state, plus idempotency-key dedup on `client_request_id` — verified this actually catches over-batching and safely no-ops a retried submission (integration tests written, gated on `TEST_DATABASE_URL` since no DB is provisioned yet — not run against a live Postgres in this session).
- Ingestion (`ingestionService.ts` / `ingestionValidation.ts`) follows [[04-ingestion-contract]]: file-level all-or-nothing on bad headers or >50% row failure, individual bad rows logged to `demand_exceptions` rather than dropped. Validation logic kept pure and unit-tested (10 tests, no DB needed).
- Verified: lint, typecheck, build, and unit tests all pass. **Not yet verified:** an actual migration run and integration-test pass against a real Postgres — no local Postgres/Docker available in this session, and no Neon connection string provisioned yet. Do this before considering the backend "working," not just "compiling."
- Uptime research: neither Neon nor Railway's default/starter tiers carry a real contractual uptime SLA — Neon's 99.95% SLA requires Business/Scale plan, Railway's contractual SLA requires Business Class/Enterprise. Flagged in [[05-deployment-runbook]] as an open plan-tier decision for a ₹450cr/year line.

## 2026-09-18 — Stack finalized: TS + Fastify, username/password auth, monitoring toolset

- Backend stack decided: Node.js + TypeScript + Fastify (up from PackTrack Pro's plain JS + Express) — see [[01-architecture]] "Deviations from PackTrack Pro." Reason: materially higher concurrency (100+ users) and correctness bar (₹450cr/year ledger) than PackTrack ever had.
- Labour login method decided: username/password for all roles (dropped the phone+OTP option considered in [[03-data-model]]).
- Monitoring toolset decided: **Sentry** (error tracking, both backend + frontends) + **Better Stack** (structured logs, uptime, alerting) — fills the Monitoring section in [[01-architecture]] that was previously TBD.
- **Microsoft Clarity considered and explicitly rejected** — session-replay/heatmap tooling doesn't fit an internal tool with known users, and conflicts with the labour app's offline/weak-wifi design and raises a consent question with no offsetting benefit. Full reasoning in [[01-architecture]].

## 2026-09-18 — Repo created, skeleton established

Decided repo name `ninjacart-shelf-batching` under `github.com/Jerseyno07`. Stack, schema, ADR-001 (FSN-level locking), and ingestion contract drafted for product review — see [[02-adr-001-fsn-level-locking]], [[03-data-model]], [[04-ingestion-contract]]. No feature code written yet; backend build starts once these are approved.
