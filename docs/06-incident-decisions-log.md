---
tags: [log, append-only]
---

# Incident & Decisions Log

Append-only. Add an entry every time a non-obvious decision is made or an incident happens — as it happens, not retroactively. Newest at top.

---

## 2026-09-18 — Stack finalized: TS + Fastify, username/password auth, monitoring toolset

- Backend stack decided: Node.js + TypeScript + Fastify (up from PackTrack Pro's plain JS + Express) — see [[01-architecture]] "Deviations from PackTrack Pro." Reason: materially higher concurrency (100+ users) and correctness bar (₹450cr/year ledger) than PackTrack ever had.
- Labour login method decided: username/password for all roles (dropped the phone+OTP option considered in [[03-data-model]]).
- Monitoring toolset decided: **Sentry** (error tracking, both backend + frontends) + **Better Stack** (structured logs, uptime, alerting) — fills the Monitoring section in [[01-architecture]] that was previously TBD.
- **Microsoft Clarity considered and explicitly rejected** — session-replay/heatmap tooling doesn't fit an internal tool with known users, and conflicts with the labour app's offline/weak-wifi design and raises a consent question with no offsetting benefit. Full reasoning in [[01-architecture]].

## 2026-09-18 — Repo created, skeleton established

Decided repo name `ninjacart-shelf-batching` under `github.com/Jerseyno07`. Stack, schema, ADR-001 (FSN-level locking), and ingestion contract drafted for product review — see [[02-adr-001-fsn-level-locking]], [[03-data-model]], [[04-ingestion-contract]]. No feature code written yet; backend build starts once these are approved.
