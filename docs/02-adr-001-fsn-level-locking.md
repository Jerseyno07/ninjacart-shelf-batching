---
tags: [adr, concurrency, status/proposed]
---

# ADR-001: FSN-level claim/lease locking for Shelf Batching

**Status:** Proposed — pending [[00-overview|product owner]] review before implementation.
**Date:** 2026-09-18
**Related:** [[03-data-model]], [[01-architecture]]

## Context

Shelf Batching lets warehouse labour fulfil SKU-wise (FSN-wise) demand across darkstores. A single FSN can be needed by 100+ darkstores. We expect 100+ concurrent labourers on shared Android devices over weak warehouse wifi, and this ledger underpins a ~₹450cr/year business line moving ~4.5 lakh units/day — silent double-counting or lost work is not an acceptable failure mode.

The open question is **lock granularity**: do we lock per (FSN, darkstore) cell, or per FSN as a whole?

## Decision

**Lock at the FSN grain, not the (FSN, darkstore) cell grain.**

When a labourer taps into an FSN, they acquire an exclusive lease on that entire FSN before the darkstore list is shown. While held, no other user can open that FSN's darkstore list at all. The lease releases only when the labourer explicitly exits/closes the FSN (all darkstores done, or backs out), or when it expires from inactivity.

This is deliberate, not a technical shortcut: **one labourer owns a SKU end-to-end across all its darkstores** in a sitting, rather than multiple labourers picking off different darkstores of the same FSN in parallel.

### Mechanism

- Table `fsn_locks`, unique on `fsn`.
- Acquire: `INSERT ... ON CONFLICT (fsn) DO UPDATE SET labour_id = EXCLUDED.labour_id, expires_at = EXCLUDED.expires_at WHERE fsn_locks.expires_at < now() OR fsn_locks.labour_id = $labourId` — succeeds if the FSN is unlocked, the existing lease has expired, **or the requester already holds it** (a retried acquire from the same labourer — offline-queue retry, a re-rendered effect — re-affirms/extends rather than 409ing against themselves; found this the hard way in a real browser session, see [[06-incident-decisions-log]]). This is a single atomic statement; there is no read-then-write race window.
- Lease duration: sized for realistic FSN handling time (batching many darkstore rows in one sitting), not a short per-cell lease — expect several minutes, not 2–3. Exact value to be tuned against real handling-time data post-launch; default `LEASE_DURATION_MINUTES = 15`.
- Heartbeat: client pings every ~30s while active inside the FSN's screens, extending `expires_at`. A dead client (dropped network, backgrounded/killed app, dead phone) stops heartbeating and the lease expires on its own — no manual admin action needed for the common case.
- Release: explicit on exit (writes `expires_at = now()` immediately), or implicit via expiry.
- Backstop: supervisors get a manual force-unlock action, fully audited (`fsn_lock_events` — who, when, why).

### What the lock does *not* do

The lock governs **who may open the FSN's UI**, not correctness of individual submissions. Every darkstore-row submission — even from the labourer who legitimately holds the lock — is independently re-verified with an atomic check-then-insert against the ledger (see [[03-data-model]] §batching_events). This catches bugs like a stale client screen re-submitting, independent of lock state. **Never trust the lock alone for correctness** — it is a UX/throughput mechanism, not the integrity mechanism.

## Trade-off accepted

**Parallelism cost:** while one labourer holds an FSN with, say, 120 darkstore rows, no one else can pick up even the 90 rows that labourer hasn't touched yet. In the worst case (a labourer starts an FSN, gets pulled away, and the lease hasn't expired), that FSN's remaining darkstores sit idle for up to `LEASE_DURATION_MINUTES`.

We accept this because:
1. It matches the real operational model — one person physically walks the shelf and picks for a SKU across bins; splitting an FSN across multiple simultaneous pickers on the floor doesn't reflect how picking actually happens and would cause physical collisions, not just data collisions.
2. It **eliminates a whole class of races** that per-cell locking would still leave: two labourers each holding valid locks on *different* darkstore cells of the same FSN, both reading a stale "remaining demand" figure derived from the same FSN, is the kind of correctness bug this document exists to prevent. FSN-level locking removes the need to reason about interleaved partial views of the same SKU.
3. Throughput is bounded by floor labour count and lease duration, not by lock contention math — at expected concurrency (100+ users, thousands of FSNs), FSN-level contention on any single FSN is expected to be rare and short-lived, not a bottleneck.

## Alternative considered: per-(FSN, darkstore) cell locking

Rejected for Phase 1. It would allow more parallelism (multiple labourers working different darkstores of the same FSN simultaneously) but:
- Multiplies the number of live locks by ~120x (one per darkstore row instead of one per FSN), increasing lock-table churn and heartbeat traffic on already-weak wifi.
- Does not match the physical picking workflow (see above).
- Adds no correctness benefit over FSN-level locking + the atomic check-then-insert on every submission — the ledger already prevents double-counting regardless of lock grain.

If real-world usage shows FSN-level locking is a throughput bottleneck (e.g. a small number of "hot" FSNs with huge darkstore fan-out routinely blocking multiple labourers), this can be revisited without a data-model rewrite: `fsn_locks` is a separate table from `batching_events`, so swapping to a finer or coarser lock grain later does not touch the ledger.

## Consequences

- Labour app must show, when an FSN is locked by someone else, **who** holds it (name or ID) and that it will free up shortly — not open the darkstore list.
- The lock UX depends on reliable heartbeats; the offline queue (see [[01-architecture]]) must treat "send heartbeat" as its own queued, retried action, distinct from batch submissions.
- Supervisors need a force-unlock control in the admin panel, with audit logging — this is a day-1 requirement, not deferred.
