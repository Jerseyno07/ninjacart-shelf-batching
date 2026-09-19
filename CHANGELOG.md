# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Entries explain *why*, not just *what* — the diff already shows the what.

## [Unreleased] — sync-import: migrating in demand already fulfilled in a parent system

### Added
- **Sync existing progress** upload (`POST /api/v1/admin/demand/sync-upload`, admin-only): a second, clearly separate section on the Demand Upload page for cutting over from a parent system that's already fulfilled some of the current demand. Format: the normal 3 columns plus `QtyFulfilled`. No schema change was needed — because remaining quantity is already derived from the ledger, a sync import just inserts `batching_events` rows for the already-fulfilled amount (attributed to the admin running the sync), and every downstream read path picks it up automatically.
- Validation: a row where `QtyFulfilled` exceeds `QtyRequired` is rejected (`fulfilled_exceeds_required`), not clamped or silently accepted — confirmed with the project owner rather than assumed.
- Downloadable sample CSVs for both the normal and sync upload sections; a shared `DemandUploadCard` component (the two upload widgets were near-identical).
- 9 new backend tests (7 unit, 2 integration against a real database) — 34/34 passing. Verified live in a real browser: uploaded the sample sync file, confirmed the FSN Completion page's remaining-quantity math matched the fixture exactly down to individual darkstore rows, and confirmed the ledger attribution via a direct DB query.

## [Unreleased] — first live Railway deployment

### Added
- All three apps deployed live to Railway (project `ninjacart-shelf-batching`): `backend` (Docker builder, forced explicitly since Railway's default `RAILPACK` was silently ignoring our Dockerfile), `labour-app` and `admin-panel` (static builds served via `serve`). `CORS_ORIGINS` on the backend locked to just the two real frontend domains, verified with real preflight requests (allowed from both, rejected from an untrusted origin). End-to-end verified: `/health` and a real login against the live Neon `production` database over the public domain. Full account in `docs/06-incident-decisions-log.md` and `docs/05-deployment-runbook.md`.

## [Unreleased]

### Added
- Repo scaffold: `CLAUDE.md`, docs vault (`docs/`), `CONTRIBUTING.md`, CI workflow, PR template — established before any feature code, per project kickoff requirements around auditability for a ₹450cr/year business line.
- ADR-001: FSN-level claim/lease locking for Shelf Batching (drafted, pending approval) — see `docs/02-adr-001-fsn-level-locking.md`. Documents why the lock is scoped to the whole FSN rather than per-darkstore-cell, since this is the decision most likely to be revisited later.
- Draft data model and demand-ingestion contract (pending approval) — see `docs/03-data-model.md`, `docs/04-ingestion-contract.md`.

### Decided
- Backend stack: Node.js + TypeScript + Fastify + raw SQL (`pg`) — deviates from PackTrack Pro's plain JS + Express, justified by higher concurrency and correctness requirements. See `docs/01-architecture.md`.
- Labour login: username/password for all roles.
- Monitoring: Sentry + Better Stack. Microsoft Clarity evaluated and explicitly rejected — see `docs/01-architecture.md`.

### Added
- Backend core: `backend/` scaffold (Fastify + TypeScript + `pg`), 7 migrations for the full schema in `docs/03-data-model.md`, and the concurrency-critical services implementing ADR-001 exactly as documented:
  - `lockService.ts` — atomic FSN-level lock acquire/heartbeat/release/force-unlock, fully audited via `fsn_lock_events`.
  - `ledgerService.ts` — atomic check-then-insert batch submission, idempotency-key dedup, FSN/darkstore list queries deriving remaining qty from the ledger (never a stored counter).
  - `ingestionValidation.ts` / `ingestionService.ts` — demand-file header/row validation per `docs/04-ingestion-contract.md`, all-or-nothing at the file level, individual bad rows logged to `demand_exceptions` rather than dropped.
  - Auth (JWT + bcrypt, username/password), Sentry init, full route map in `backend/README.md`.
- Unit tests for ingestion validation (always run); integration tests for lock acquire and ledger submit, gated on `TEST_DATABASE_URL` since no DB is provisioned yet.
- Dummy ingestion schema fixtures (`backend/test/fixtures/`) — `FSN,Darkstore,QtyRequired` CSVs covering the clean, mostly-valid, and majority-invalid cases, plus an integration test exercising the full ingestion pipeline against them. Real headers still TBC from the external source.
- Labour app (`labour-app/`): React + Vite + Tailwind PWA. Login, FSN list (polling), FSN detail screen (lock acquire → darkstore list → partial-entry batching → submit/back-navigation-confirm flow exactly as specified in `docs/00-overview.md`), IndexedDB-backed offline queue with idempotent retry, installable manifest + service worker. Not yet tested against a live backend.
- `docs/07-infrastructure-cost-and-migration.md`: why Neon/Railway were picked, a reliability/cost comparison against AWS (Aurora/RDS + Fargate) and GCP (Cloud SQL + Cloud Run), what's already been done to keep a future migration cheap, and the concrete risks of migrating later. Decision for now: stay on Neon/Railway.
- `backend/Dockerfile` + `.dockerignore`: multi-stage build, added purely as a migration hedge so the backend is container-portable to any platform — Railway doesn't need this today. Not yet verified with a real `docker build` (no Docker available in this environment).
- Neon project `sweet-frog-87532306` (Ninjacart-WMS) set up and linked; ran the real migrations against the `production` branch for the first time (all 7 applied cleanly, and the most recent down-migration was verified to actually work); created a disposable `test` branch for integration tests.

### Fixed
- `ledgerService.ts`'s atomic check-then-insert combined `FOR UPDATE` with `GROUP BY`, which Postgres rejects — every batch submission was broken. Found by running the integration tests against a real database for the first time. Fixed by locking the `demand` row first, then summing `batching_events` as a second statement in the same transaction (still fully atomic).
- `ingestionService.ts` inserted demand/exception rows one at a time in a loop — fine against a mock, but slow enough over real network latency to time out on a 15-row test file. Fixed with a single batched `INSERT ... SELECT ... FROM unnest(...)` per table; also matters for real demand files with hundreds of rows, not just the tests.
- `test/lockService.integration.test.ts` shared one FSN across two tests and didn't release the lock at the end of the first, so the second test's first call threw unexpectedly instead of its second call as intended — a test-isolation bug, not a service bug. Each test now uses its own FSN.

## [Unreleased] — real end-to-end run (backend HTTP + labour app in a real browser)

### Fixed
- Backend had **no CORS configuration** — every cross-origin request from the labour app to the API failed preflight. Neither `curl` nor the service-level integration tests could have caught this. Added `@fastify/cors`, configurable via a new `CORS_ORIGINS` env var.
- `labour-app`'s API client always sent `Content-Type: application/json` even on bodyless requests (lock/heartbeat/release), which Fastify's JSON parser rejects outright. Fixed to only set that header when there's an actual body.
- `lockService.ts`'s acquire UPSERT didn't account for the requester already holding the (unexpired) lock themselves, so a retried acquire from the same labourer — exactly what the offline-queue architecture anticipates, and what a React dev-mode double-effect invocation reproduced live — incorrectly 409'd against itself. Fixed the `WHERE` clause to also allow `fsn_locks.labour_id = $2`; added a regression test.
- `labour-app`'s `AuthProvider` restored the session from `localStorage` inside a `useEffect`, so a full page reload rendered one frame with `user: null` and `ProtectedRoute` redirected to `/login` before the effect ever ran — a valid session couldn't survive a reload. Matters specifically for this app's target devices (shared, flaky-network phones where reloads are routine). Fixed by restoring synchronously in `useState`'s initializer.

### Verified
- Full real-HTTP walkthrough of every backend route via `curl` against the real `production` database: login, multipart demand upload, FSN list, lock acquire/conflict/release, partial batch submit, idempotent retry, over-batch rejection, admin force-unlock and locks view — all matched the documented contract with no bugs found at this layer.
- Full real-browser walkthrough of the labour app against the running backend: login persists across a reload, lock acquire/conflict/self-reacquire, partial-entry batching, the three-way exit-confirmation dialog, and a verified-in-the-database lock release on discard.
- See `docs/08-testing-log.md` for the complete account, including the four bugs found and exactly how each was reproduced.

## [Unreleased] — backend additions for the admin panel

### Added
- `userService.ts` + `POST/GET/PATCH /api/v1/admin/users` — create, list, deactivate/reactivate, and reset-password for user accounts (admin-only). Duplicate usernames map to a clean 409, not a raw DB constraint error. Passwords are bcrypt-hashed the same way as the seed accounts.
- `dashboardService.ts` + `GET /api/v1/admin/dashboard/summary` (admin/supervisor) — latest ingestion status, completion % derived from the ledger (never a stored counter), and active-lock count in one call.
- `GET /api/v1/admin/fsns/:fsn/darkstores` (admin/supervisor) — read-only completion view that does **not** require holding the FSN lock, unlike the labour-facing `GET /api/v1/fsns/:fsn/darkstores`. Needed so a supervisor can watch progress without taking the lock away from whoever's actually working it.
- Integration tests for all of the above (`userService.integration.test.ts`, `dashboardService.integration.test.ts`), passing against the disposable `test` branch. Also set `fileParallelism: false` in `vitest.config.ts` — multiple integration test files sharing one live database, with at least one now asserting on *global* "latest" state, made cross-file parallelism a real race risk, not a theoretical one.
- Verified all three new endpoint groups over real HTTP (create/list/deactivate a user, confirmed a deactivated user can no longer log in; dashboard summary; admin darkstores view) against the real `production` database.

## [Unreleased] — admin panel

### Added
- `admin-panel/`: React + Vite + Tailwind, desktop-first (no offline queue/service worker, unlike `labour-app` — admins work at a desk on a real connection). Pages: Dashboard, Demand Upload (+ exception viewer with CSV download), FSN Completion (read-only drill-down, doesn't touch the FSN lock), Active Locks (+ force-unlock with required reason), Users (admin-only). Labour-role accounts are rejected client-side at login with a clear message.

### Fixed
- `@fastify/cors`'s auto-detected `Access-Control-Allow-Methods` header silently omitted `PATCH` (came back as just `GET,HEAD,POST`) — every PATCH request's browser preflight succeeded but the browser then refused to send the actual request, with nothing in the server logs since it never arrived. Found by actually clicking "Deactivate" in the admin panel, not by curl or the integration tests. Fixed by explicitly declaring `methods: ["GET", "POST", "PATCH", "DELETE"]` instead of relying on auto-detection.

### Verified
- Full real-browser walkthrough against the real backend and Postgres: labour-role login rejection, dashboard stats matching hand-checked numbers, real multipart upload + exception viewer + CSV download, FSN completion drill-down confirmed lock-free, force-unlock with a database-verified audit trail, and user create/deactivate/reactivate.
- See `docs/08-testing-log.md` for the full account.

## [Unreleased] — Railway deployment

### Fixed
- `backend/tsconfig.json`'s `rootDir: "."` (spanning both `src/` and `test/`) meant `tsc` output the compiled entry point at `dist/src/index.js`, not `dist/index.js` as `package.json`'s `start` script and `Dockerfile`'s `CMD` both assumed. `npm run build` always exited 0, so this was invisible to lint/typecheck/build and only surfaced as a crash loop on the first real Railway deploy (`Cannot find module '/app/dist/index.js'`). Fixed with a new `tsconfig.build.json` (src-only, flat output) that `npm run build` now uses; `tsconfig.json` is unchanged and still correct for `npm run typecheck`. Verified this time by actually running `node dist/index.js` and hitting `/health`, not just checking the build command's exit code.
- Corrected a wrong claim in `docs/08-testing-log.md` that the Dockerfile's output had already been verified — it hadn't; only the build command's exit code had been checked.
