---
tags: [log, append-only]
---

# Incident & Decisions Log

Append-only. Add an entry every time a non-obvious decision is made or an incident happens — as it happens, not retroactively. Newest at top.

---

## 2026-09-18 — First live Railway deployment: all three services up

Deployed all three apps to the project owner's existing Railway account (workspace `jerseyno07's Projects`, no new account needed) — new project `ninjacart-shelf-batching`, three services connected to `Jerseyno07/ninjacart-shelf-batching`'s `main` branch.

- **`backend`**: had to explicitly set `dockerfilePath: Dockerfile` — Railway's default `RAILPACK` builder was silently ignoring our Dockerfile and using its own auto-generated build plan instead (config showed `builder: RAILPACK` even with a Dockerfile present at the service's root directory). Once forced to `DOCKERFILE`, this is what actually exposed the `dist/index.js` bug documented separately below/in [[08-testing-log]] — the Railpack-built image failed identically, so at first it looked like a Railway quirk, but switching builders and seeing the exact same crash is what proved it was a real bug in our own build config, not a platform-detection issue.
- **`labour-app`** / **`admin-panel`**: no Dockerfile for these — explicit `buildCommand`/`startCommand` (`npx serve -s dist`) instead, since they're static SPAs. `VITE_API_BASE_URL` had to be set *before* the first build (Vite bakes env vars in at build time), so the sequence was: create service → set root directory + build/start commands → set `VITE_API_BASE_URL` → connect source (which triggers the actual build).
- `labour-app`'s first build attempt failed with empty logs and no diagnosis; retrying with identical config succeeded. Treated as transient Railway infra flakiness, not a real bug — but noting it in case it recurs and turns out not to be.
- `CORS_ORIGINS` on the backend was set to the two real frontend domains only, deployed *after* both frontend domains existed (chicken-and-egg: backend needs to know the frontend URLs, frontends need to know the backend URL — resolved by deploying backend first with a placeholder, then generating both frontend domains, then updating the backend's `CORS_ORIGINS` and redeploying). Verified with real preflight `curl -X OPTIONS` calls from each real origin (allowed) and from an arbitrary untrusted origin (correctly rejected — no `Access-Control-Allow-Origin` header comes back).
- End-to-end verified: `/health`, and a real `/api/v1/auth/login` against the live Neon `production` database, both over the public backend domain — not just that the build succeeded.
- Full runbook in [[05-deployment-runbook]].

## 2026-09-18 — First Railway deploy attempt found a real build-path bug (dist/index.js)

Started deploying to Railway (project `ninjacart-shelf-batching`, workspace `jerseyno07's Projects`, using the account's existing personal workspace — no new Railway account needed). Backend service crash-looped on the very first deploy with `Error: Cannot find module '/app/dist/index.js'`.

- **Root cause:** `backend/tsconfig.json` has `rootDir: "."` with `include` spanning both `src/**/*.ts` and `test/**/*.ts`. Because the effective root covers two top-level directories, `tsc` preserves the `src/` prefix in its output — the real compiled entry point was `dist/src/index.js`, not `dist/index.js` as `package.json`'s `start` script and `Dockerfile`'s `CMD` both assumed. `npm run build` always exited 0, so lint/typecheck/build all "passed" while silently producing the wrong layout — this was invisible to every check performed until an actual deploy tried to run the output.
- **Secondary finding:** Railway's first attempt used its own `RAILPACK` builder, not `backend/Dockerfile`, because `dockerfilePath` wasn't set on the service — fixed by setting it explicitly, which switched the builder to `DOCKERFILE`. The crash persisted identically after that switch, which is what pointed at the real (build-path) bug rather than a Railway-detection problem.
- **Fix:** added `backend/tsconfig.build.json` (extends the base config, `rootDir: "src"`, `src`-only `include`) and pointed `npm run build` at it. The original `tsconfig.json` is unchanged and still correctly covers `src`+`test` for `npm run typecheck`. Verified by actually running `node dist/index.js` locally and hitting `/health` — not just checking the build command's exit code, which is exactly the gap that let this bug hide for this long. Also corrected [[08-testing-log]]'s earlier (wrong) claim that this had already been checked.
- Sixth real bug found by "actually run it," after the four in the labour-app session and the CORS one in the admin-panel session — all invisible to lint/typecheck/unit/integration tests, all caught only by an actual run against something real.

## 2026-09-18 — Admin panel built and tested end-to-end; fifth real bug found (CORS methods)

## 2026-09-18 — Admin panel built and tested end-to-end; fifth real bug found (CORS methods)

Built `admin-panel/` (React + Vite + Tailwind, desktop-first, no offline queue/service worker — admins work at a desk on a real connection). Pages: Dashboard, Demand Upload (+ exception viewer/CSV download), FSN Completion (read-only drill-down), Active Locks (+ force-unlock), Users (admin-only, gated by `AdminOnlyRoute` and hidden from the supervisor nav). Login rejects `labour` accounts client-side with a clear message.

Ran the same real-browser-against-real-backend process that caught bugs in the labour app, this time on the admin panel:

- Verified working end to end: labour-role rejection, dashboard stats matching hand-checked numbers, real multipart upload + exception viewer + CSV download, FSN completion drill-down (confirmed it does **not** acquire a lock), a lock created via curl appearing automatically within one poll cycle, force-unlock releasing it with the audit trail confirmed via direct DB query, and user create/deactivate/reactivate all confirmed against real data.
- **One real bug found and fixed:** `@fastify/cors`'s auto-detected `Access-Control-Allow-Methods` came back as `GET,HEAD,POST` — silently missing `PATCH` (and `DELETE`). Every PATCH request's preflight succeeded, but the browser then refused to send the actual request, surfacing only as `fetch()` throwing `TypeError: Failed to fetch` with nothing in the server logs (the request never arrived). Fixed by explicitly declaring `methods: ["GET", "POST", "PATCH", "DELETE"]` on the CORS plugin instead of relying on its default detection. Same class of bug as the missing-CORS-config issue found while building the labour app — invisible to curl and to the service-level integration tests, only found by driving a real browser.
- Full account in [[08-testing-log]].

## 2026-09-18 — Backend additions for the admin panel: user management, dashboard summary, lock-free completion view

## 2026-09-18 — Backend additions for the admin panel: user management, dashboard summary, lock-free completion view

Planned and built the backend prerequisites for the admin panel (agreed with the project owner: user management scope = full CRUD; new-user passwords are admin-set, not auto-generated).

- User management (`userService.ts`, `POST/GET/PATCH /api/v1/admin/users`, admin-only): create, list, deactivate/reactivate, reset password. Verified over real HTTP — created a supervisor account, deactivated it, confirmed the deactivated account can no longer log in (401).
- Dashboard summary (`dashboardService.ts`, `GET /api/v1/admin/dashboard/summary`, admin/supervisor): latest ingestion status + ledger-derived completion % + active-lock count. Verified against real data (12.3% complete on the seeded demand batch, matching hand-checked totals).
- Read-only FSN completion view (`GET /api/v1/admin/fsns/:fsn/darkstores`, admin/supervisor) — deliberately does **not** require holding the FSN lock, unlike the labour-facing version. A supervisor needs to watch progress without taking the lock away from whoever's actually working the FSN.
- Added integration tests for both new services, passing against the disposable `test` branch (25/25 total now). Also caught and fixed a latent test-suite risk while adding these: multiple integration test files share one live database, and the new dashboard test asserts on *global* "latest batch" state — under Vitest's default cross-file parallelism, another file's insert could race it. Set `fileParallelism: false`.
- Next: the admin panel app itself (`admin-panel/`), consuming all of this — separate PR.

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
