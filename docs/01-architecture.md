---
tags: [architecture, status/proposed]
---

# Architecture (proposed — for review)

Related: [[02-adr-001-fsn-level-locking]], [[03-data-model]]

## Shape

One backend, two client apps:

- **Backend API** — single source of truth. Node.js + TypeScript + Express, Postgres (Neon) via `pg` (raw parameterized SQL for the concurrency-critical paths — no ORM abstraction between us and the atomic upserts/transactions in [[03-data-model]]). Deployed on Railway, same pattern as PackTrack Pro.
- **Labour App** — mobile-first PWA. React + Vite + Tailwind, installable (manifest + service worker), IndexedDB-backed offline queue (`idb` library).
- **Admin Panel** — desktop-first web app. React + Vite + Tailwind. Demand upload, user management, exception handling, live completion dashboards, force-unlock.

Both clients talk only to the backend API. Client-side logic is limited to optimistic UI and offline queuing — no duplicated business rules.

## Why TypeScript here (deviation from PackTrack Pro's plain JS)

PackTrack Pro's backend is plain Node/Express JS. This system has a materially higher correctness bar (concurrency-critical ledger, ₹450cr/year line) — flagging for confirmation, not assuming: propose TypeScript on the backend for the schema/API-contract layer, kept pragmatic (no heavy generic abstractions) rather than switching the whole team's habits. If this is unwanted, plain JS with strong integration tests is the fallback.

## Auth

Bearer JWT + bcrypt, matching PackTrack Pro. Role-based: `labour`, `supervisor`, `admin`. See [[03-data-model]] open question on labour login method.

## Offline & sync (labour app)

- Every lock-acquire and submit action is written to the local IndexedDB queue *before* the network call fires, keyed by the same client-generated idempotency UUID used server-side ([[03-data-model]] `client_request_id`).
- Optimistic UI: action buttons disable immediately on tap; never allow a double-tap to produce two in-flight requests for the same action.
- A background sync loop retries queued actions when connectivity returns, using the same idempotency key on every retry — safe no-ops server-side if the original already landed.
- Per-action state visible to the labourer: `pending` / `synced` / `rejected: <reason>`.
- List screens (FSN list, darkstore list) poll every 5–10s — not websockets, deliberately: simpler, resilient to reconnects on bad wifi, no sticky-session infra needed at this concurrency scale (100+ users).
- Full offline: show the last-known snapshot with a visible "offline as of [time]" banner, never a blank screen.

## Monitoring (day 1, not deferred)

- Structured logs on every write path (ingestion, lock acquire/release, batch submit) sufficient to reconstruct "what happened" for an incident.
- Alerting on: ingestion failures/file-level rejects, abnormal lock contention (many failed acquires on the same FSN), API error rate spikes.
- Where these live (Railway logs vs. an external tool) — TBD, tracked in [[06-incident-decisions-log]] once decided.

## Deploy

Railway (both backend and — TBD, likely also Railway or a static host for the two frontends), Neon Postgres. See [[05-deployment-runbook]].
