# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Entries explain *why*, not just *what* — the diff already shows the what.

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
