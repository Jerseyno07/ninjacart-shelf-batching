---
tags: [data-model, status/proposed]
---

# Data Model (proposed — for review)

**Status:** Draft, pending approval. Related: [[02-adr-001-fsn-level-locking]], [[04-ingestion-contract]]

Postgres (Neon), matching [[01-architecture]]. All monetary/quantity fields are integers (units), never floats. Every table that can be touched concurrently either is append-only or is written through an atomic conditional statement — never a plain read-then-`UPDATE`.

Structured so **full-lot ("SS") batching** could be reintroduced later as an alternate `batch_type` without a rewrite: the ledger and demand tables carry a `batch_type` discriminator now, even though only `'shelf'` is populated in Phase 1.

## `users`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| username | text unique | login identity for all roles, including labour |
| password_hash | text | bcrypt, matching PackTrack Pro's auth pattern |
| role | text | `labour` \| `supervisor` \| `admin` |
| active | boolean | deactivated users can't log in or acquire locks |
| created_at | timestamptz | |

## `demand_batches` (ingestion versioning)

One row per ingested demand file. See [[04-ingestion-contract]].

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| source_filename | text | as received |
| uploaded_by | uuid fk → users | admin who triggered ingestion |
| status | text | `processing` \| `completed` \| `completed_with_errors` \| `failed` |
| total_rows | int | |
| valid_rows | int | |
| rejected_rows | int | |
| created_at | timestamptz | |
| completed_at | timestamptz | null until done |

## `demand`

The demand lines from the *latest successfully ingested* batch. Never mutated in place by batching activity — remaining qty is always derived (see `batching_events` below), not stored here.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| demand_batch_id | uuid fk → demand_batches | which ingestion produced this row |
| fsn | text | SKU code |
| darkstore_id | text | |
| batch_type | text | `'shelf'` for Phase 1; reserved for future `'full_lot'` |
| qty_required | int | as ingested |
| created_at | timestamptz | |

Unique on `(fsn, darkstore_id, batch_type, demand_batch_id)`. A new ingestion batch supersedes the previous one for reporting purposes (see [[04-ingestion-contract]] for how re-ingestion / deltas are handled) but old rows are never deleted — they stay for audit trail, filtered by `demand_batch_id`.

## `demand_exceptions`

Malformed/rejected rows from ingestion, one row per bad input row, never silently dropped.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| demand_batch_id | uuid fk → demand_batches | |
| raw_row | jsonb | the original row, verbatim, for debugging |
| row_number | int | 1-indexed position in source file |
| reason | text | e.g. `missing_fsn`, `qty_not_numeric`, `unknown_darkstore`, `duplicate_row` |
| created_at | timestamptz | |

## `fsn_locks`

The claim/lease lock described in [[02-adr-001-fsn-level-locking]].

| column | type | notes |
|---|---|---|
| fsn | text pk | unique — the lock target |
| labour_id | uuid fk → users | current holder |
| acquired_at | timestamptz | |
| expires_at | timestamptz | extended by heartbeat |
| released_at | timestamptz | null while held |

Acquire is always:
```sql
INSERT INTO fsn_locks (fsn, labour_id, acquired_at, expires_at)
VALUES ($1, $2, now(), now() + interval '15 minutes')
ON CONFLICT (fsn) DO UPDATE
  SET labour_id = EXCLUDED.labour_id, acquired_at = now(), expires_at = EXCLUDED.expires_at, released_at = NULL
  WHERE fsn_locks.expires_at < now()
RETURNING *;
```
Zero rows returned ⇒ someone else holds it; the API returns 409 with the current holder's name for the "who holds it" UI.

## `fsn_lock_events`

Audit trail for locks — every acquire, heartbeat-extend, explicit release, expiry, and supervisor force-unlock.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| fsn | text | |
| labour_id | uuid fk → users | |
| event_type | text | `acquired` \| `heartbeat` \| `released` \| `expired` \| `force_unlocked` |
| actor_id | uuid fk → users, nullable | set for `force_unlocked` (the supervisor) |
| reason | text, nullable | supervisor-entered reason for force-unlock |
| created_at | timestamptz | |

## `batching_events` (the ledger — append-only, source of truth)

Never updated or deleted. "Remaining qty for a darkstore" is always `demand.qty_required - SUM(batching_events.qty_batched WHERE fsn=... AND darkstore_id=... AND demand_batch_id=...)`.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| demand_batch_id | uuid fk → demand_batches | which demand version this batches against |
| fsn | text | |
| darkstore_id | text | |
| batch_type | text | `'shelf'` |
| qty_batched | int | > 0 |
| labour_id | uuid fk → users | |
| client_request_id | uuid | idempotency key, unique per row, client-generated |
| created_at | timestamptz | |

Unique constraint on `client_request_id` — a retried submission with the same key is a safe no-op (`ON CONFLICT (client_request_id) DO NOTHING`, then the API re-reads to confirm to the client it landed).

Every insert happens inside a transaction that re-checks, as **two** statements — Postgres rejects `FOR UPDATE` combined with `GROUP BY`/aggregates, so the row lock and the sum can't be one query (found the hard way, by actually running this against a real database — see [[06-incident-decisions-log]]):
```sql
-- 1. Lock the demand row. A concurrent submitter for the same
--    (fsn, darkstore, batch) cell blocks here until this transaction commits.
SELECT qty_required FROM demand
WHERE fsn = $1 AND darkstore_id = $2 AND demand_batch_id = $3
FOR UPDATE;

-- 2. Sum the ledger — consistent with everything already committed, because
--    of the lock above.
SELECT COALESCE(SUM(qty_batched), 0) AS batched FROM batching_events
WHERE fsn = $1 AND darkstore_id = $2 AND demand_batch_id = $3;
-- remaining = qty_required - batched
-- if remaining < qty_batched requested: reject with 409, do not insert
```
This re-verification is independent of `fsn_locks` — it protects against a stale client re-submitting even while holding a valid lock.

## Indexes (initial)

- `demand (fsn, batch_type, demand_batch_id)`, `demand (darkstore_id, demand_batch_id)`
- `batching_events (fsn, darkstore_id, demand_batch_id)`, `batching_events (labour_id, created_at)`
- `fsn_locks (expires_at)` — for expiry sweeps / dashboards on stuck locks

## Open questions for product review

1. ~~Labour login method~~ — **resolved 2026-09-18: username/password**, all roles.
2. Demand file re-ingestion: does a new file *replace* all prior demand for darkstores it covers, or *add to* existing outstanding demand? This changes how `demand_batch_id` versioning behaves on re-upload — flagged here, resolved in [[04-ingestion-contract]] once the external file's real cadence is confirmed.
