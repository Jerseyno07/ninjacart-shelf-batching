# CLAUDE.md

Guidance for Claude Code (and human contributors) working in this repo.

## What this is

Shelf Batching system for Ninjacart warehouse labour — see [[docs/00-overview]] for the full picture. Separate repo from PackTrack Pro (another Ninjacart warehouse project by the same owner); don't assume shared code, but do carry forward the conventions below, which are lessons from that project.

## Before touching locking or batching code

Read [[docs/02-adr-001-fsn-level-locking]] first. The FSN-level lock grain is a deliberate trade-off, not an oversight — don't "fix" it into per-darkstore locking without re-reading the ADR's reasoning.

## Stack (see [[docs/01-architecture]] for the full proposal)

- Backend: Node.js + TypeScript + Fastify, `pg` (raw parameterized SQL for concurrency-critical paths — no ORM between us and the atomic upserts).
- DB: Postgres via Neon.
- Frontend (both apps): React + Vite + Tailwind.
- Deploy: Railway, auto-deploy from `main`.
- Auth: Bearer JWT + bcrypt, username/password for all roles including labour.
- Monitoring: Sentry (errors, both backend and frontends) + Better Stack (logs, uptime, alerting). Microsoft Clarity deliberately not used — see [[docs/01-architecture]] for why.

## Conventions carried forward from PackTrack Pro (fix what caused pain there)

- **Commit style:** conventional commits (`feat:`, `fix:`, `chore:`, etc.) with a `Co-Authored-By` trailer when Claude Code makes the commit.
- **Never commit plaintext secrets or passwords** — not even to a private repo. Redact before committing; real secrets live in Railway env vars / a local untracked `.env`.
- **This repo has an external collaborator with push access** (first time for this owner) — unlike PackTrack Pro, do **not** push directly to `main`. Branch protection requires a PR + at least one review. See [[CONTRIBUTING.md]] for the review gate.
- **Migrations are reversible and reviewed** — this is a production ledger for a ₹450cr/year line, not a dev sandbox. Every migration ships with its down-migration in the same PR.
- **Update docs as you go, not retroactively.** PackTrack Pro's docs were solid but keep [[docs/06-incident-decisions-log]] and `CHANGELOG.md` current in the same PR as the code change, every time — don't defer this to "later."

## Review gate (read [[CONTRIBUTING.md]])

Every PR from the external collaborator gets reviewed for correctness and adherence to the concurrency/data-model rules in [[docs/02-adr-001-fsn-level-locking]] and [[docs/03-data-model]] before merge. The repo owner gives explicit approval after seeing that review summary — this is enforced as an actual PR template + CI step, not a verbal agreement.

## Local dev

- Backend: `cd backend && npm install && cp .env.example .env` (fill in `DATABASE_URL` from Neon — see [[docs/05-deployment-runbook]]) `&& npm run migrate:up && npm run dev`.
- This repo is linked to Neon project `sweet-frog-87532306` — `neon link` at the repo root pulls a fresh `DATABASE_URL` into `.env.local` if needed.
- **Never run the integration tests (`*.integration.test.ts`) against the `production` branch.** Use the disposable `test` branch instead: `TEST_DATABASE_URL=$(neon connection-string test --project-id sweet-frog-87532306) npm test` from `backend/`. That branch's schema can drift from `production` — re-run `npm run migrate:up` against it after any migration change.
- Run DB-touching scripts from `backend/` (matches PackTrack Pro's gotcha: `pg` and friends are only installed there, not at the repo root).
