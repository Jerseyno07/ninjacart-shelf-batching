# backend

Node.js + TypeScript + Fastify API, Postgres (Neon) via raw parameterized SQL (`pg`, no ORM). See `../docs/01-architecture.md` and `../docs/02-adr-001-fsn-level-locking.md` before touching `lockService.ts` or `ledgerService.ts`.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL (Neon) and JWT_SECRET
npm run migrate:up
npm run dev
```

## Scripts

- `npm run dev` — run with hot reload
- `npm run build` / `npm start` — production build + run
- `npm run lint` / `npm run typecheck` — must pass before merge (CI enforced)
- `npm test` — unit tests (no DB required) + integration tests (skipped unless `TEST_DATABASE_URL` is set)
- `npm run migrate:up` / `migrate:down` — apply/roll back migrations; every migration in `migrations/` has a paired `up`/`down`

## Testing the concurrency-critical paths

`test/lockService.integration.test.ts`, `test/ledgerService.integration.test.ts`, and `test/ingestionService.integration.test.ts` exercise the exact behavior ADR-001 and the ingestion contract depend on (atomic lock acquire, atomic check-then-insert, idempotency-key dedup, file-level ingestion validation). They're skipped by default — set `TEST_DATABASE_URL` to a real Postgres with migrations applied to run them:

```bash
TEST_DATABASE_URL=postgres://... npm test
```

A disposable Neon branch named **`test`** (project `sweet-frog-87532306`) already exists for this — branched off `production` with the schema already migrated. Get its connection string on demand (never commit it) with:

```bash
neon connection-string test --project-id sweet-frog-87532306
```

If `backend/migrations/` changes, re-run `npm run migrate:up` against that branch's connection string too — branching doesn't keep it in sync with `production` automatically, it only snapshotted the schema at creation time.

These integration tests are exactly what caught two real bugs during initial setup: `ledgerService.ts`'s atomic check-then-insert originally combined `FOR UPDATE` with `GROUP BY`, which Postgres rejects outright (fixed by locking the `demand` row first, then summing `batching_events` as a second statement in the same transaction); and `ingestionService.ts` inserted one row at a time, which timed out against real network latency for a 15-row file (fixed with a single batched `INSERT ... SELECT ... FROM unnest(...)` per table). Neither bug was visible from lint/typecheck/build/unit-tests alone — treat "not yet run against a real DB" as a real gap, not a formality, going forward.

Everything else that can be tested without a database (ingestion validation rules) is a plain unit test and always runs.

## Route map

```
POST /api/v1/auth/login

POST /api/v1/fsns/:fsn/lock              — acquire FSN lock (gates darkstore list)
POST /api/v1/fsns/:fsn/heartbeat         — extend lease while active
POST /api/v1/fsns/:fsn/release           — explicit exit, releases lock
GET  /api/v1/admin/fsns/locks            — supervisor visibility
POST /api/v1/admin/fsns/:fsn/force-unlock — supervisor backstop, audited

GET  /api/v1/fsns                        — FSN list w/ total remaining qty
GET  /api/v1/fsns/:fsn/darkstores        — only if caller holds the lock
POST /api/v1/fsns/:fsn/batch             — submit touched darkstore rows

POST /api/v1/admin/demand/upload                       — ingest a demand file
POST /api/v1/admin/demand/sync-upload                   — ingest demand with existing fulfilled qty (seeds the ledger)
GET  /api/v1/admin/demand/batches                      — ingestion history
GET  /api/v1/admin/demand/batches/:id/exceptions        — rejected-row report

POST  /api/v1/admin/users                — create a user (admin only)
GET   /api/v1/admin/users                — list all users (admin only)
PATCH /api/v1/admin/users/:id            — deactivate/reactivate, reset password (admin only)

GET  /api/v1/admin/dashboard/summary     — latest ingestion + completion % + active lock count (admin/supervisor)
GET  /api/v1/admin/fsns/:fsn/darkstores  — read-only completion view, no lock required (admin/supervisor)
```
