# ninjacart-shelf-batching

Shelf Batching system: warehouse labour fulfil SKU-wise (FSN) demand across darkstores. Phase 1 of a larger warehouse tooling initiative for Ninjacart — see `docs/00-overview.md` for the full picture, and `docs/02-adr-001-fsn-level-locking.md` before touching any locking or batching code.

**Status:** scaffold only — no feature code yet. Stack, schema, ADR-001, and the ingestion contract are drafted in `docs/` pending review; backend build starts once those are approved.

## Layout

- `backend/` — API, Postgres (Neon) via `pg`, Node.js + TypeScript + Express (proposed)
- `labour-app/` — mobile-first offline-tolerant PWA for warehouse labour (proposed)
- `admin-panel/` — desktop-first admin/supervisor web app (proposed)
- `docs/` — Obsidian-compatible docs vault: architecture, data model, ADRs, ingestion contract, runbook, decisions log
- `CLAUDE.md` — conventions and stack notes for AI-assisted development in this repo
- `CONTRIBUTING.md` — local setup, branch naming, PR review gate

See `CHANGELOG.md` for what's landed.
