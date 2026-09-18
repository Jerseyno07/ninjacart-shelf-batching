---
tags: [architecture, status/proposed]
---

# Architecture (proposed — for review)

Related: [[02-adr-001-fsn-level-locking]], [[03-data-model]]

## Shape

One backend, two client apps:

- **Backend API** — single source of truth. Node.js + TypeScript + Fastify, Postgres (Neon) via `pg` (raw parameterized SQL for the concurrency-critical paths — no ORM abstraction between us and the atomic upserts/transactions in [[03-data-model]]). Deployed on Railway.
- **Labour App** — mobile-first PWA. React + Vite + Tailwind, installable (manifest + service worker), IndexedDB-backed offline queue (`idb` library).
- **Admin Panel** — desktop-first web app. React + Vite + Tailwind. Demand upload, user management, exception handling, live completion dashboards, force-unlock.

Both clients talk only to the backend API. Client-side logic is limited to optimistic UI and offline queuing — no duplicated business rules.

## Deviations from PackTrack Pro, and why

PackTrack Pro's scale (a few dozen warehouse execs, low write concurrency) doesn't hold here (100+ concurrent labourers, a ₹450cr/year ledger). Two deliberate changes:

- **Plain JS → TypeScript.** Compile-time safety on the API contracts between backend and two frontends, and on the row shapes going through the ledger/lock SQL — a wrong field name or an `undefined` where a `qty_batched: number` is expected is exactly the kind of bug that's cheap to catch statically and expensive to catch in production on this data.
- **Express → Fastify.** Both sit on the same raw-SQL `pg` layer; this is the smaller change. Fastify's lower per-request overhead and built-in schema validation matter because of the polling model below — 100+ clients polling every 5–10s is a materially higher steady-state request rate than PackTrack ever saw.

Everything else (JWT + bcrypt auth, React/Vite/Tailwind, Railway/Neon, raw SQL over an ORM) is unchanged from PackTrack Pro on purpose — those choices weren't scale-sensitive there and aren't here either.

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

- **Sentry** — error tracking on both the backend (Fastify) and both frontends (React). Every unhandled exception carries request/user context (labour ID, FSN, `client_request_id`) via breadcrumbs, so an incident is diagnosable from the error report alone, not by grepping logs first.
- **Better Stack** — centralized structured logs (ingestion runs, lock acquire/release/expiry, every `batching_events` write) beyond Railway's own short-retention logs, plus uptime checks on the API and alert routing (Slack/email) for: ingestion failures/file-level rejects, abnormal lock contention (repeated failed acquires on the same FSN), and API error-rate spikes.
- **Microsoft Clarity — explicitly not used.** Considered and rejected: it's session-replay/heatmap tooling for understanding anonymous users' UX behavior, which doesn't fit here — the labour app's users are known floor staff you can just ask, its offline/weak-wifi design competes with Clarity's continuous background beacon traffic, and recording every tap of warehouse staff on shared devices raises a consent question with no offsetting benefit once Sentry + Better Stack + the audit ledger already cover "what happened."

## Deploy

Railway (both backend and — TBD, likely also Railway or a static host for the two frontends), Neon Postgres. See [[05-deployment-runbook]].
