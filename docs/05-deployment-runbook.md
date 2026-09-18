---
tags: [runbook, status/partial]
---

# Deployment Runbook

## Neon (done — 2026-09-18)

- Project: `sweet-frog-87532306` (Ninjacart-WMS), org `org-gentle-base-26380712`. CLI: `npm i -g neon@latest`, `neon login`.
- This directory is linked to the `production` branch (`.neon`, gitignored). `neon link --project-id sweet-frog-87532306 --branch production` re-links if needed.
- `neon mcp` was run **pinned to this project** (`--project --project-id sweet-frog-87532306`), not the default account-wide grant — the minted key can only touch this one project. See [[06-incident-decisions-log]] for why that matters.
- `backend/.env`'s `DATABASE_URL` is pulled from `.env.local` at the repo root (`neon link` / `neon deploy` write this; both gitignored). Re-pull anytime with `neon deploy --env-pull` or by re-running `neon link`.
- A disposable `test` branch (`br-silent-heart-b5updgpc`) exists off `production` for integration tests — see `backend/README.md`. It does **not** auto-sync with `production`; re-run `npm run migrate:up` against it if `backend/migrations/` changes.
- All 7 backend migrations have been run against `production` for real (not just linted) — see `backend/migrations/`.

## Railway (not done yet)

- Planned: Railway project, auto-deploy from `main`, `DATABASE_URL` set from the Neon `production` branch's **pooled** connection string (not `DATABASE_URL_UNPOOLED`).
- Migrations: reversible, reviewed in PR before merge — this data cannot be casually reset in production. Every migration ships with a paired down-migration (verified working for the most recent one — see [[06-incident-decisions-log]]).
- Env vars needed: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `LOCK_LEASE_MINUTES`, `SENTRY_DSN` — see `backend/.env.example`. Not yet set in Railway itself; still TBD.

See [[07-infrastructure-cost-and-migration]] for the full cost/reliability comparison against AWS/GCP and why we're staying on Neon/Railway for now.

## Plan-tier decision (open — neither provider's default tier has a real SLA)

- **Neon:** 99.95% monthly uptime SLA with tiered service credits only on the **Business or Scale plan** — Free/Launch carries no contractual guarantee at all.
- **Railway:** no published, standardized SLA for Hobby/Pro — a contractual SLA with remedies exists only on **Business Class/Enterprise**, negotiated case-by-case.
- Given this is a ₹450cr/year, ~4.5 lakh units/day line, decide explicitly which paid tier to run production on rather than defaulting to whatever tier the project starts on — flagged here for a decision, not yet made. Record the decision (and cost) in [[06-incident-decisions-log]] once picked.

## Rollback

TBD — document the actual rollback procedure the first time it's needed, with what worked and what didn't.
