---
tags: [testing, verification, status/living-doc]
---

# Testing Log

Related: [[02-adr-001-fsn-level-locking]], [[03-data-model]], [[04-ingestion-contract]], [[06-incident-decisions-log]]

Every check that has actually been run against this codebase, what it covers, and what it found — including the two real bugs that only a live-database run caught. This is a **living doc**: append a new dated entry whenever a new kind of check is run, or an existing one is re-run with a different result. Don't retroactively rewrite history here — if something passed then and fails now, add a new entry, don't edit the old one away.

## Why this exists

Lint, typecheck, and a green build tell you the code is *well-formed*. They do not tell you it is *correct*. This system found that out directly: `ledgerService.ts`'s core atomic check-then-insert query passed lint, typecheck, and build cleanly while being fundamentally broken (`FOR UPDATE` combined with `GROUP BY`, which Postgres rejects outright) — only caught once the integration tests actually ran against a real Postgres branch. See the 2026-09-18 entries in [[06-incident-decisions-log]] for the full story. This log exists so "we ran the tests" always means something specific and checkable, not a vague assurance.

## Verification layers, in order of what they actually catch

| Layer | Tool | Catches | Does NOT catch |
|---|---|---|---|
| Lint | ESLint | Unused vars, style issues, some correctness smells (`@typescript-eslint/recommended`) | Any runtime/SQL behavior |
| Typecheck | `tsc --noEmit` | Type mismatches across the codebase (backend and labour-app both use `strict` + `noUncheckedIndexedAccess`) | Whether the SQL string is valid, whether the DB accepts it |
| Build | `tsc` (backend), `tsc -b && vite build` (labour-app) | Whether the code actually compiles/bundles to something runnable | Runtime correctness |
| Unit tests | Vitest, `backend/test/ingestionValidation.test.ts` | Pure validation logic — no DB needed | Anything touching a real database |
| Integration tests | Vitest + a real Postgres via `TEST_DATABASE_URL` | **Actual database behavior** — this is the layer that caught both real bugs below | Concurrency at real scale (100+ simultaneous users) — still untested, see [[06-incident-decisions-log]]/open risk |
| Manual smoke test | `vite preview` + `curl` | The built static app actually serves | Any real user interaction |

## Backend (`backend/`)

### Lint — `npm run lint` (ESLint, `.eslintrc.cjs`)
- **Status:** passing, verified most recently 2026-09-18.
- **History:** failed once on first run (`'reply' is defined but never used` in `src/middleware/auth.ts`) — fixed by renaming the unused parameter to `_reply`. Every run since has been clean.

### Typecheck — `npm run typecheck` (`tsc -p tsconfig.json --noEmit`)
- **Status:** passing, verified most recently 2026-09-18. Clean on every run so far — no failures recorded.

### Build — `npm run build` (`tsc -p tsconfig.json` → `dist/`)
- **Status:** passing, verified most recently 2026-09-18. Clean on every run so far.

### Unit tests — `npm test` (no DB required)

File: `test/ingestionValidation.test.ts` — pure functions in `src/services/ingestionValidation.ts`, no I/O. **17/17 passing** (10 original + 7 added for the sync-import format, see below), every run since creation.

| Test case | What it checks |
|---|---|
| `validateHeaders` passes when all required headers are present, case-insensitively | Header matching is case-insensitive (`fsn`/`FSN`/`Fsn` all accepted) |
| `validateHeaders` reports missing headers | Missing a required column (`Darkstore`) is named explicitly in the error |
| `validateRows` accepts well-formed rows | The happy path produces exactly the expected `ValidRow` shape |
| `validateRows` rejects a row with missing FSN, without dropping it silently | An empty `FSN` is rejected with reason `missing_fsn` and the raw row is preserved verbatim in the rejection record |
| `validateRows` rejects non-numeric quantity | `QtyRequired: "abc"` → `qty_not_numeric` |
| `validateRows` rejects zero and negative quantity | `"0"` → `qty_not_positive`; `"-5"` → `qty_not_numeric` (regex requires digits only, so a leading `-` fails the numeric check first) |
| `validateRows` rejects duplicate FSN+darkstore rows within the same file | Second occurrence of the same `(FSN, Darkstore)` pair → `duplicate_row`, first occurrence stays valid |
| `validateRows` rejects rows referencing an unknown darkstore when a known set is provided | `unknown_darkstore` reason fires when a reference set is passed — **note:** production code currently calls this with `null` (no reference set) since no darkstore master list exists yet, so this path is unit-tested but not yet exercised in the real pipeline. Flagged in [[04-ingestion-contract]] as a known gap. |
| `validateRows` flags a file-level error when more than 50% of rows are invalid, and discards partial results | Crosses the file-level reject threshold ([[04-ingestion-contract]]) — confirms `validRows` comes back empty rather than partially applied |
| `validateRows` flags an empty file distinctly | Zero rows → `"File contains no data rows"`, a distinct message from the >50% case |

### Integration tests — `TEST_DATABASE_URL=... npm test` (real Postgres required)

These are **skipped** (not failed — `describe.skipIf`) whenever `TEST_DATABASE_URL` isn't set, which was the case for most of this project's early history. They have now actually been run for real, once, against a disposable Neon `test` branch (`br-silent-heart-b5updgpc`, project `sweet-frog-87532306`) on 2026-09-18.

**First real run — 2026-09-18, before fixes: 13 passed, 5 failed.**

| Test case | File | Result | Why |
|---|---|---|---|
| lets a second labourer acquire once the first explicitly releases | `lockService.integration.test.ts` | ✅ pass | — |
| blocks a second labourer while the first holds an unexpired lock | `lockService.integration.test.ts` | ❌ fail | **Test bug**, not a service bug: shared one `fsn` across both tests without releasing at the end of the first, so this test's *first* call threw instead of the second as intended |
| accepts a submission within remaining demand | `ledgerService.integration.test.ts` | ❌ fail | `FOR UPDATE is not allowed with GROUP BY clause` — real bug in `ledgerService.ts` |
| rejects a submission that would exceed remaining demand | `ledgerService.integration.test.ts` | ❌ fail | same real bug |
| treats a retried client_request_id as a safe no-op, not a double insert | `ledgerService.integration.test.ts` | ❌ fail | same real bug |
| ingests a fully valid file as 'completed' with no exceptions | `ingestionService.integration.test.ts` | ✅ pass | — |
| ingests a mostly-valid file as 'completed_with_errors' | `ingestionService.integration.test.ts` | ❌ fail | Timed out at vitest's default 5000ms — one-`INSERT`-per-row over real network latency was too slow |
| fails the whole file when >50% of rows are invalid | `ingestionService.integration.test.ts` | ✅ pass | (fast — file-level reject happens before any row inserts) |
| all 10 `ingestionValidation.test.ts` unit tests | — | ✅ pass | unaffected, no DB involved |

**Fixes applied** (full detail in [[06-incident-decisions-log]] and the `ledgerService.ts`/`ingestionService.ts` source comments):
1. `ledgerService.ts`: split the single `FOR UPDATE ... GROUP BY` query into two statements in the same transaction — lock the `demand` row first, then sum `batching_events`.
2. `ingestionService.ts`: replaced the per-row `INSERT` loops with one batched `INSERT ... SELECT ... FROM unnest(...)` per table.
3. `lockService.integration.test.ts`: gave each `it()` its own `fsn` instead of sharing one across the describe block.
4. `vitest.config.ts`: raised `testTimeout` to 15000ms as a margin for real network round-trips (defensive, on top of fix #2 actually removing the slowness).

**Second real run — 2026-09-18, after fixes: 18/18 passed.**

| Test case | File | Result | Duration |
|---|---|---|---|
| lets a second labourer acquire once the first explicitly releases | `lockService.integration.test.ts` | ✅ pass | 2170ms |
| blocks a second labourer while the first holds an unexpired lock | `lockService.integration.test.ts` | ✅ pass | 1541ms |
| ingests a fully valid file as 'completed' with no exceptions | `ingestionService.integration.test.ts` | ✅ pass | 1392ms |
| ingests a mostly-valid file as 'completed_with_errors' | `ingestionService.integration.test.ts` | ✅ pass | 1822ms (down from a >5000ms timeout) |
| fails the whole file when >50% of rows are invalid | `ingestionService.integration.test.ts` | ✅ pass | 1309ms |
| accepts a submission within remaining demand | `ledgerService.integration.test.ts` | ✅ pass | 1652ms |
| rejects a submission that would exceed remaining demand | `ledgerService.integration.test.ts` | ✅ pass | 1287ms |
| treats a retried client_request_id as a safe no-op, not a double insert | `ledgerService.integration.test.ts` | ✅ pass | 2578ms |
| all 10 `ingestionValidation.test.ts` unit tests | — | ✅ pass | ~3ms total |

**What each integration test actually verifies, concretely:**
- **Lock tests** exercise the literal atomic `INSERT ... ON CONFLICT ... WHERE expires_at < now()` from [[02-adr-001-fsn-level-locking]] against a real Postgres — confirms a released lock can be re-acquired by someone else, and an unexpired held lock genuinely blocks a second acquirer (not just "the code doesn't throw," but "Postgres actually enforces the conflict").
- **Ledger tests** exercise the atomic check-then-insert: a submission within remaining demand is accepted; one exceeding it is rejected with `InsufficientRemainingError` and **nothing is inserted** (checked implicitly by the third test); a retried `client_request_id` is confirmed via `SELECT COUNT(*) ... WHERE client_request_id = $1` to have inserted **exactly one row**, not two.
- **Ingestion tests** exercise the full pipeline end-to-end against `backend/test/fixtures/*.csv` — a clean 15-row file lands as `completed` with 15 `demand` rows and 0 exceptions; a 15-row file with 2 bad rows lands as `completed_with_errors` with exactly 2 `demand_exceptions` rows, reasons checked in row order (`missing_fsn`, `qty_not_numeric`); an 8-row file with 5 bad rows (62.5%, over the 50% threshold) is rejected wholesale, confirmed by `SELECT COUNT(*) FROM demand WHERE demand_batch_id = $1` returning 0.

**Third real run — 2026-09-18, adding the admin-panel backend prerequisites: 25/25 passed** (the 18 above, plus a new lock self-reacquire regression test from the E2E session, plus these):

| Test case | File | What it checks |
|---|---|---|
| creates a user with a bcrypt-hashed password, never the plaintext | `userService.integration.test.ts` | The stored `password_hash` isn't the plaintext password and actually verifies with `bcrypt.compare` |
| rejects a duplicate username with ConflictError, not a raw DB error | `userService.integration.test.ts` | The Postgres unique-violation (`23505`) is mapped to a clean `ConflictError`, not leaked as a raw driver error |
| lists users including the one just created | `userService.integration.test.ts` | Basic list correctness |
| deactivates a user via updateUser | `userService.integration.test.ts` | `active: false` persists |
| throws NotFoundError when updating a nonexistent user | `userService.integration.test.ts` | A bogus UUID doesn't silently no-op |
| reports the latest ingestion and completion percentage derived from the ledger | `dashboardService.integration.test.ts` | The summary's completion % is computed from `SUM(batching_events.qty_batched)`, not a stored counter, matching hand-inserted ledger rows |

**Also fixed while adding these:** `vitest.config.ts` now sets `fileParallelism: false`. Multiple integration test files share one live database, and `dashboardService`'s test asserts on *global* "latest batch" state (not just its own rows) — under Vitest's default cross-file parallelism, another file's concurrent insert could win that race. This was a latent risk in the suite before this change, not something newly introduced by it.

**Also verified over real HTTP** (curl, against `production`, not the disposable branch): created a real `supervisor1` account, deactivated it, confirmed the deactivated account gets a 401 on login; hit the dashboard summary endpoint and hand-checked the completion percentage against the raw numbers; hit the new lock-free admin darkstores view and confirmed it returns data without ever acquiring a lock.

**Fourth real run — 2026-09-19, sync-import feature (docs/04-ingestion-contract.md "Sync existing progress"): 34/34 passed** (the 25 above, plus):

| Test case | File | What it checks |
|---|---|---|
| requires QtyFulfilled in addition to the base columns | `ingestionValidation.test.ts` | Missing the 4th header is reported by name |
| passes when all four columns are present, case-insensitively | `ingestionValidation.test.ts` | Header matching mirrors the base contract's case-insensitivity |
| accepts a row with QtyFulfilled less than QtyRequired | `ingestionValidation.test.ts` | The happy path |
| accepts QtyFulfilled of exactly 0 | `ingestionValidation.test.ts` | `0` is valid — means nothing synced for that row yet |
| accepts QtyFulfilled equal to QtyRequired | `ingestionValidation.test.ts` | Fully-synced boundary case |
| rejects QtyFulfilled greater than QtyRequired rather than clamping or accepting it | `ingestionValidation.test.ts` | The explicit product decision (see [[06-incident-decisions-log]]): reject, don't silently adjust |
| rejects a non-numeric QtyFulfilled | `ingestionValidation.test.ts` | Same numeric-check discipline as the base `QtyRequired` column |
| seeds the ledger with already-fulfilled quantity, attributed to the syncing admin | `ingestionSync.integration.test.ts` | Real DB: 4 of 5 fixture rows have `QtyFulfilled > 0` → exactly 4 `batching_events` rows created, all with `labour_id` = the uploading admin; the row with `QtyFulfilled = 0` gets **no** ledger row at all (untouched, not a zero-value entry); remaining is confirmed correctly derived (`40/40` synced → `0` remaining) |
| rejects a file where a row's QtyFulfilled exceeds QtyRequired, without seeding a bad ledger entry | `ingestionSync.integration.test.ts` | Real DB: the good row in a 2-row file still gets its ledger entry; the bad row gets `fulfilled_exceeds_required` in `demand_exceptions` and **no** ledger row |

**Also verified live in a real browser** (admin-panel, real backend, real Postgres): uploaded `sample-sync-valid.csv` through the actual "Sync existing progress" UI section; confirmed the FSN Completion page's remaining-quantity math matched the fixture exactly for every FSN and every darkstore (not just totals — drilled into `FSN-APPLE-001` and checked all three darkstore rows individually); confirmed via a direct DB query that the 4 expected `batching_events` rows exist, attributed to `admin`, and the `QtyFulfilled = 0` row correctly has none.

**Seventh run — 2026-09-21, upload size limit: 55/55 passed** (the 52 above, plus 3 in `uploadLimit.test.ts`): limit is exactly 10 MB; a 5 MB file (over the old 1 MB default) is accepted; a file over 10 MB gets `413 FILE_TOO_LARGE`, not 500. Uses `app.inject` with real multipart bodies against a minimal Fastify app wired the same way as `src/index.ts` (no DB needed).

**Sixth real run — 2026-09-20, dashboard metrics + bulk user upload: 52/52 passed** (the 35 above, plus):

| Test case | File | What it checks |
|---|---|---|
| 11 cases: headers, valid/case-insensitive role, missing name/username, invalid role, in-file duplicate, existing username, >50% file-level reject, empty file | `userBulkValidation.test.ts` | Pure validation rules |
| creates users with generated, bcrypt-hashed passwords | `userBulkService.integration.test.ts` | Real DB: password is 12 chars, stored hash != plaintext, `bcrypt.compare` succeeds |
| rejects a username that already exists / mixed valid+invalid file | `userBulkService.integration.test.ts` | Real DB existing-username lookup; valid rows still created |
| labour productivity excludes `source='sync'`; darkstore % across FSNs; FSN classified in-progress | `dashboardMetrics.integration.test.ts` | Real DB aggregates |

**Also verified live in a real browser:** dashboard showed labour bar (125 units), FSN stack (2 in progress spanning the full axis), darkstore bars (27% / 100% / 67%), all matching the API payload; Users page bulk upload of a 3-row CSV gave 2 created with credentials table and 1 `invalid_role` reject. Test users removed afterwards. Two apparent chart bugs (blank pie; short bar) were investigated: the pie was replaced, the short bar was mid-animation.

**Fifth real run — 2026-09-19, "Batched On Flash" column (`source` on `batching_events`): 35/35 passed** (the 34 above, plus):

| Test case | File | What it checks |
|---|---|---|
| (extended) accepts a submission within remaining demand | `ledgerService.integration.test.ts` | Now also asserts the inserted `batching_events` row has `source = 'labour'` |
| separates sync-sourced qty from labour-sourced qty in batchedOnFlash | `ledgerService.integration.test.ts` | Real DB: seeds a `source = 'sync'` row directly, then a real `submitBatch` call on top of it for the same darkstore; `listDarkstoresForFsn` returns `batchedOnFlash = 3` (sync only), `qtyBatched = 5` (both), `remaining = 5` — confirms the `FILTER (WHERE source = 'sync')` aggregation is correct when a darkstore has mixed-provenance ledger entries, not just single-source ones |

Migration up/down/up re-verified against the Neon `test` branch before this run.

**Also verified live in a real browser** (admin-panel, real backend, real production-branch Postgres): uploaded a fresh 2-row sync CSV (`FSN-VERIFY-001`: `DS-BLR-01` 20 required/8 fulfilled, `DS-KOR-01` 10 required/0 fulfilled) through the "Sync existing progress" section; the FSN Completion darkstore drill-down showed the new **Batched On Flash** column reading `8` and `0` respectively, matching the uploaded `QtyFulfilled` exactly, with `Batched` also `8`/`0` (no labour activity yet) and `Remaining` correctly `12`/`10`. Test rows deleted from the production database afterward. **Real bug caught by this step** (not by any automated check): the local dev backend was pointed at the production Neon branch via `.env`, which hadn't had the new migration applied yet — only the disposable `test` branch had, since that's the only database the automated integration-test run touches. The sync-upload endpoint failed with `column "source" of relation "batching_events" does not exist` on the first live attempt; fixed by running `npm run migrate:up` against `.env` before retrying. Full account in [[06-incident-decisions-log]].

### Migrations — `npm run migrate:up` / `migrate:down`
- **Status:** all 7 migrations run for real against the Neon `production` branch (`sweet-frog-87532306`), 2026-09-18 — applied cleanly, in order, no errors.
- **Reversibility check:** ran `migrate:down` once against the most recent migration (`1758182400006_batching_events`) — confirmed the table actually drops — then `migrate:up` again to restore it. This is the only down-migration that's been exercised so far; the other 6 have valid `down` functions (verified by a static check that each migration file exports both `up` and `down` as functions) but have not been individually run in the down direction against a real database.

### Real HTTP walkthrough (curl, real `production` DB) — 2026-09-18

Ran `npm run dev` for real (not `vitest`) against the Neon `production` branch and drove every route via `curl` — a layer the service-level integration tests don't cover, since those call the functions directly and never go through Fastify's routing, auth middleware, or JSON serialization.

Seeded real `admin`/`labour1`/`labour2` accounts (none existed yet), then walked: login as admin → upload `sample-demand-valid.csv` via the real multipart endpoint (`completed`, 15/15 valid) → login as labour1 → `GET /fsns` (real totals matching the upload) → acquire lock on `FSN-APPLE-001` → a second labourer's acquire attempt correctly 409s with the holder's name, and their direct `GET .../darkstores` correctly 403s even bypassing the lock UI → submit a partial batch (2 of 3 darkstores) → the third stays untouched → retrying the same `client_request_id` returns `duplicate`, confirmed exactly one row via `SELECT COUNT(*)` → over-batching a darkstore past its remaining qty returns `rejected` with the exact shortfall in the message → release → a second labourer can then acquire → admin's active-locks view and force-unlock endpoint both work → demand-batches list reflects the real upload.

Every one of these matched the documented contract exactly — no bugs found at this layer specifically (the three real bugs below were found one layer up, at the browser boundary).

### Docker / production build — 2026-09-18, real bug found deploying to Railway

**Original claim in this doc was wrong** — it said the Dockerfile "matches the already-verified `npm run build` output (`dist/index.js` exists and runs)." That was never actually checked; only `npm run build`'s exit code was checked, not what file it produced or whether `node dist/index.js` ran. Correcting the record rather than quietly editing it away.

**What was actually wrong:** `tsconfig.json` had `rootDir: "."` with `include` covering both `src/**/*.ts` and `test/**/*.ts`. Since the effective root spanned two top-level directories, `tsc` preserved the `src/` prefix in its output — the real compiled entry point was `dist/src/index.js`, not `dist/index.js` as `package.json`'s `start` script and the `Dockerfile`'s `CMD` both assumed. `npm run build` exited 0 either way, so this was invisible to every check performed until now — lint, typecheck, and the build command itself all "succeeded" while silently producing the wrong output layout.

**How it was actually found:** deploying to Railway. The very first live deploy crash-looped with `Error: Cannot find module '/app/dist/index.js'`, repeating every ~10s as Railway's restart policy retried it. (First occurred under Railway's own `RAILPACK` builder, which wasn't even using our Dockerfile — fixed that mismatch too, by setting `dockerfilePath` explicitly — but the crash persisted identically once the real Dockerfile build ran, which is what pointed at the actual bug.)

**Fix:** added `tsconfig.build.json` (extends the base config, `rootDir: "src"`, `include: ["src/**/*.ts"]` only — excludes `test/`) and pointed `npm run build` at it. `tsconfig.json` itself is unchanged and still covers `src`+`test` for `npm run typecheck`, which is correct as-is. Verified for real this time: `rm -rf dist && npm run build`, confirmed `dist/index.js` exists directly, then actually ran `node dist/index.js` and hit `/health` — got `{"status":"ok"}`.

**Lesson recorded, not just fixed:** "the build command exits 0" and "the file the deploy config expects to run actually exists at that path" are different claims. Verify the second one explicitly, the same way this doc now insists on for everything else.

## Labour app (`labour-app/`)

### Lint — `npm run lint` (ESLint, `.eslintrc.cjs`, includes `react-hooks/rules-of-hooks`)
- **Status:** passing, verified most recently 2026-09-18. Clean on every run — no failures recorded.

### Typecheck — `npm run typecheck` (`tsc -b --noEmit`)
- **Status:** passing, verified most recently 2026-09-18. Clean on every run.

### Build — `npm run build` (`tsc -b && vite build`)
- **Status:** passing. Produces the PWA service worker (`dist/sw.js`) and manifest correctly.

### Manual smoke test (build artifact only) — 2026-09-18
- **What was done:** ran `vite preview` in the background, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` and a raw fetch of the HTML.
- **Result:** `HTTP 200`, correct `<title>` and `<link rel="manifest">` in the served HTML.
- **What this did NOT cover at the time:** no browser had been driven against the running backend yet. Closed in the next entry.

### Real browser, real backend, real Postgres — 2026-09-18

Ran `backend` (`npm run dev`, port 3001 to avoid a conflict with an unrelated local service on 3000) against the Neon `production` branch, and `labour-app` (`npm run dev`, port 5173) pointed at it via `VITE_API_BASE_URL`. Seeded real accounts (`admin`, `labour1`, `labour2`) since none existed yet, uploaded `sample-demand-valid.csv` through the real multipart endpoint, then drove the actual UI with a real Chrome browser (via the `claude-in-chrome` MCP tools) — not curl, not a service-level integration test.

**This caught three real bugs that no prior layer had caught, because it's the first time anything exercised the browser↔API boundary or the exact SQL condition below:**

1. **No CORS configuration at all.** Every cross-origin request from the labour app (port 5173) to the API (port 3001) failed preflight (`OPTIONS` → 404). `curl` never hits this (no CORS enforcement) and the integration tests never hit this (they call service functions directly, not HTTP). Fixed: added `@fastify/cors`, configurable via a new `CORS_ORIGINS` env var.
2. **Every bodyless POST (lock/heartbeat/release) failed with 400.** `client.ts` always sent `Content-Type: application/json` even with no body; Fastify's JSON parser rejects an empty body under that header outright. Manifested as a lock-acquire failure the instant a real browser tried to open an FSN. Fixed: only set that header when `options.body` is actually present.
3. **A labourer re-acquiring their own still-valid lock got a false 409.** The UPSERT's `WHERE fsn_locks.expires_at < now()` clause didn't account for the requester already being the current holder — so a retried acquire (which the offline-queue architecture explicitly anticipates, and which a React dev-mode double-effect invocation reproduced live, by accident, during this session) conflicted against itself instead of succeeding. Fixed: `WHERE fsn_locks.expires_at < now() OR fsn_locks.labour_id = $2`, plus a new regression test (`lets a labourer re-acquire (extend) a lock they already hold, without conflict`) added to `lockService.integration.test.ts` and passing against the disposable `test` branch.

**After all three fixes, verified in the real browser:** login persists across a full page reload (this surfaced and fixed a fourth issue — see below); FSN list renders real data; opening a locked-by-someone-else FSN shows the holder's name and blocks the darkstore list even via direct URL; partial-entry batching (touching 1 of 2 darkstore rows) submits correctly and leaves the other row untouched; the three-way Submit & exit / Discard & exit / Cancel dialog appears with the correct unsaved-entry count; Discard & exit navigates back and genuinely releases the lock server-side (confirmed via direct DB query, not just UI appearance).

**Bonus fourth bug, found the same way:** a full page reload always bounced to `/login` even with a valid session in `localStorage`, because `AuthProvider` restored the session inside a `useEffect` — which runs *after* the first render, so `ProtectedRoute` saw `user: null` on that first render and redirected before the effect ever got a chance to run. This matters specifically for this app's target devices (shared, flaky-network Android phones where reloads/app restarts are routine, not rare). Fixed: restore synchronously in `useState`'s initializer instead of an effect.

**Data note:** this session wrote real seed accounts and a real uploaded demand batch into the Neon `production` branch (not the disposable `test` branch) — flagged to the project owner rather than silently left in place; not yet cleaned up as of this writing.

- **Still not covered:** no automated component/unit tests exist for the labour app — everything above is lint/typecheck/build + this one manual (but now real, multi-bug-catching) browser session, not a repeatable automated suite. Nothing runs this flow on every PR the way the backend's integration tests do. `syncQueue.ts`'s retry logic under actual network flakiness (offline/online transitions) and the heartbeat interval have still not been exercised.

## Admin panel (`admin-panel/`) — 2026-09-18

### Lint / typecheck / build
- **Status:** all passing. Clean from the first run.

### Real browser, real backend, real Postgres

Same process as the labour app: ran the actual backend (port 3001) and `admin-panel` (`npm run dev`, port 5174) against it, drove the real UI with a Chrome browser via `claude-in-chrome`.

**Verified working, end to end:**
- Labour-role login rejection ("This account doesn't have access to the admin panel.") — client-side, before the backend even gets a chance to 403.
- Admin login → Dashboard renders real data (completion %, active locks, latest ingestion) matching hand-checked numbers exactly.
- Demand upload (real multipart upload from the browser, not curl) → ingestion history updates, exception viewer expands with correct rows/reasons, CSV download.
- FSN Completion → drill-down into darkstore breakdown, confirmed **not** to acquire a lock while viewing.
- Active Locks → a lock created via curl appeared automatically within one poll cycle; force-unlock released it immediately, confirmed via a direct DB query that the audit event (`actor_id`, `reason`) was recorded correctly.
- Users → create, and (after the bug below was fixed) deactivate/reactivate, all confirmed against real data.

**One real bug found and fixed:** `@fastify/cors`'s auto-detected `Access-Control-Allow-Methods` header came back as `GET,HEAD,POST` — silently missing `PATCH` (and `DELETE`). Every `PATCH` request's browser preflight succeeded (`OPTIONS` → 204), but the browser then refused to send the actual `PATCH`, surfacing only as `fetch()` throwing `TypeError: Failed to fetch` — no error from the server at all, since the request never reached it. Confirmed via a direct `curl -X OPTIONS` simulation showing the incomplete allow-list, and fixed by explicitly setting `methods: ["GET", "POST", "PATCH", "DELETE"]` in the CORS plugin registration instead of relying on its default detection. This is exactly the same class of bug as the missing-CORS-config bug found in the labour-app session — `curl` and the integration tests never exercise a real browser's CORS preflight logic, so this kind of bug is invisible to every other layer.
- **Debugging note for future reference:** mid-session, repeated edits to `index.ts` and the frontend triggered enough hot-reloads that the *page's* running JS module ended up stale relative to the *server's* already-fixed CORS config, producing a few confusing false-negative retries. A hard page reload (not just retrying the click) resolved it. If a fix doesn't seem to take effect in a live E2E session, reload the page fully before concluding the fix didn't work.

## CI (`.github/workflows/ci.yml`)
Runs automatically on every PR and push to `main`. Current jobs:
- `backend (lint / typecheck / test / build)` — runs the exact commands above; **integration tests are skipped in CI** since `TEST_DATABASE_URL` is not configured as a CI secret yet. CI green therefore currently means "lint/typecheck/build/unit-tests," not "integration-tested" — that gap is closed manually, as recorded above, not automatically on every PR yet.
- `frontends (lint / build)` — matrix over `labour-app` and `admin-panel`; the latter trivially passes (nothing exists).
- `review checklist reminder` — always passes; just a text reminder, not an actual automated review.

**Open follow-up:** wire `TEST_DATABASE_URL` into CI (pointed at the disposable `test` Neon branch, or a fresh branch per run) so the integration suite — the layer that has actually caught real bugs — runs on every PR automatically, not just when someone remembers to run it manually against a real database.

## Summary table (as of 2026-09-18)

| Area | Lint | Typecheck | Build | Unit tests | Integration tests | Manual/E2E |
|---|---|---|---|---|---|---|
| Backend | ✅ | ✅ | ✅ | ✅ 17/17 | ✅ 34/34 (3 real bugs found & fixed first: broken `FOR UPDATE`+`GROUP BY`, slow per-row ingestion, self-reacquire false conflict) | ✅ real HTTP walkthrough via curl + real browser walkthrough of sync-import (login, upload, lock, conflict, partial batch, idempotent retry, over-batch reject, release, force-unlock, user CRUD, dashboard summary, lock-free completion view, sync-import seeding the ledger correctly) |
| Labour app | ✅ | ✅ | ✅ | none exist | N/A | ✅ real browser against real backend + real Postgres — found & fixed CORS, bodyless-POST Content-Type, and reload-drops-session bugs (see above) |
| Admin panel | ✅ | ✅ | ✅ | none exist | N/A | ✅ real browser against real backend + real Postgres — found & fixed a `@fastify/cors` missing-`PATCH`-method bug |
| Docker / prod build | N/A | N/A | ✅ (fixed a real `dist/index.js` path bug found via a live Railway deploy) | N/A | N/A | ✅ ran the compiled output for real, hit `/health` |
| Migrations | N/A | N/A | N/A | N/A | ✅ up + one down verified against real Postgres | N/A |
