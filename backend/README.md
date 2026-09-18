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

`test/lockService.integration.test.ts` and `test/ledgerService.integration.test.ts` exercise the exact behavior ADR-001 depends on (atomic lock acquire, atomic check-then-insert, idempotency-key dedup). They're skipped by default — set `TEST_DATABASE_URL` to a real Postgres with migrations applied (a disposable Neon branch works well for this) to run them:

```bash
TEST_DATABASE_URL=postgres://... npm test
```

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
GET  /api/v1/admin/demand/batches                      — ingestion history
GET  /api/v1/admin/demand/batches/:id/exceptions        — rejected-row report
```
