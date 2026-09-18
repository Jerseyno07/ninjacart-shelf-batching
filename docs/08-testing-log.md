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

File: `test/ingestionValidation.test.ts` — pure functions in `src/services/ingestionValidation.ts`, no I/O. **10/10 passing**, every run since creation.

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

### Migrations — `npm run migrate:up` / `migrate:down`
- **Status:** all 7 migrations run for real against the Neon `production` branch (`sweet-frog-87532306`), 2026-09-18 — applied cleanly, in order, no errors.
- **Reversibility check:** ran `migrate:down` once against the most recent migration (`1758182400006_batching_events`) — confirmed the table actually drops — then `migrate:up` again to restore it. This is the only down-migration that's been exercised so far; the other 6 have valid `down` functions (verified by a static check that each migration file exports both `up` and `down` as functions) but have not been individually run in the down direction against a real database.

### Docker — `backend/Dockerfile`
- **Status: NOT verified.** No Docker available in the environment this was built in. The Dockerfile follows a standard Node multi-stage pattern and matches the already-verified `npm run build` output (`dist/index.js` exists and runs), but "should work" is not the same as "tested" — run an actual `docker build` before relying on this for a real deploy.

## Labour app (`labour-app/`)

### Lint — `npm run lint` (ESLint, `.eslintrc.cjs`, includes `react-hooks/rules-of-hooks`)
- **Status:** passing, verified most recently 2026-09-18. Clean on every run — no failures recorded.

### Typecheck — `npm run typecheck` (`tsc -b --noEmit`)
- **Status:** passing, verified most recently 2026-09-18. Clean on every run.

### Build — `npm run build` (`tsc -b && vite build`)
- **Status:** passing. Produces the PWA service worker (`dist/sw.js`) and manifest correctly.

### Manual smoke test
- **What was done:** ran `vite preview` in the background, then `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` and a raw fetch of the HTML.
- **Result:** `HTTP 200`, correct `<title>` and `<link rel="manifest">` in the served HTML.
- **What this does NOT cover:** no browser was actually driven against the running backend — login, FSN list, lock acquire, offline-queue behavior, and the exit-confirmation dialog have **not** been exercised end-to-end in an actual browser. This is the single biggest remaining verification gap for the labour app.
- **No automated component/unit tests exist for the labour app** — everything above is lint/typecheck/build/one-manual-smoke-test only. Nothing has verified `syncQueue.ts`'s retry logic, `FsnDetailPage.tsx`'s lock-acquire/heartbeat/exit-dialog state machine, or the IndexedDB draft-cache behavior against real interaction. Flagging this explicitly rather than letting "the build passes" imply more than it does.

## Admin panel (`admin-panel/`)
- **Status:** does not exist yet as an application — only an empty CI job placeholder (`frontends (lint / build) (admin-panel)`, which reports "pass" trivially because there's nothing to lint/build). Not built, not tested. Referenced here only so this doc's coverage table is honest about what "all green in CI" currently includes.

## CI (`.github/workflows/ci.yml`)
Runs automatically on every PR and push to `main`. Current jobs:
- `backend (lint / typecheck / test / build)` — runs the exact commands above; **integration tests are skipped in CI** since `TEST_DATABASE_URL` is not configured as a CI secret yet. CI green therefore currently means "lint/typecheck/build/unit-tests," not "integration-tested" — that gap is closed manually, as recorded above, not automatically on every PR yet.
- `frontends (lint / build)` — matrix over `labour-app` and `admin-panel`; the latter trivially passes (nothing exists).
- `review checklist reminder` — always passes; just a text reminder, not an actual automated review.

**Open follow-up:** wire `TEST_DATABASE_URL` into CI (pointed at the disposable `test` Neon branch, or a fresh branch per run) so the integration suite — the layer that has actually caught real bugs — runs on every PR automatically, not just when someone remembers to run it manually against a real database.

## Summary table (as of 2026-09-18)

| Area | Lint | Typecheck | Build | Unit tests | Integration tests | Manual/E2E |
|---|---|---|---|---|---|---|
| Backend | ✅ | ✅ | ✅ | ✅ 10/10 | ✅ 18/18 (2 real bugs found & fixed first) | Not done |
| Labour app | ✅ | ✅ | ✅ | none exist | N/A | ✅ serves correctly (curl only, no browser interaction) |
| Admin panel | N/A (doesn't exist) | N/A | N/A | N/A | N/A | N/A |
| Docker | N/A | N/A | Not built | N/A | N/A | Not verified |
| Migrations | N/A | N/A | N/A | N/A | ✅ up + one down verified against real Postgres | N/A |
