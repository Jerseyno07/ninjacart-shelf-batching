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

## Railway (done — 2026-09-18)

- Project: `ninjacart-shelf-batching`, workspace `jerseyno07's Projects` (the account's existing personal workspace — no new account needed). Three services, one per app, each with `rootDirectory` set to its subfolder and connected to `Jerseyno07/ninjacart-shelf-batching` on `main` (auto-deploys on push).
- **`backend`** — builder explicitly set to `DOCKERFILE` (`dockerfilePath: Dockerfile`) — Railway's default `RAILPACK` builder otherwise ignores our Dockerfile silently and uses its own build plan instead (see [[06-incident-decisions-log]]). `DATABASE_URL` is the Neon `production` branch's **pooled** connection string (not `DATABASE_URL_UNPOOLED`). Env vars set: `DATABASE_URL`, `JWT_SECRET` (freshly generated for production, different from the local dev value), `NODE_ENV=production`, `LOCK_LEASE_MINUTES=15`, `SENTRY_DSN` (empty — Sentry not wired up yet), `CORS_ORIGINS` (the two frontend domains below). Healthcheck path `/health`. Public domain: `backend-production-d06d.up.railway.app`.
- **`labour-app`** / **`admin-panel`** — no Dockerfile; plain Railpack build with explicit `buildCommand: npm run build` and `startCommand: npx -y serve -s dist -l $PORT` (serves the Vite static output; `-s` rewrites all routes to `index.html` for the SPA). `VITE_API_BASE_URL` is set to the backend's domain **before** the first build, since Vite bakes env vars in at build time, not runtime. Public domains: `labour-app-production.up.railway.app`, `admin-panel-production-3c0c.up.railway.app`.
- `CORS_ORIGINS` on the backend is locked to exactly those two frontend domains (comma-separated) — verified with a direct `curl -X OPTIONS` preflight simulation from each real origin (allowed) and from an arbitrary untrusted origin (correctly gets no `Access-Control-Allow-Origin` header back).
- One real bug found deploying `backend` for the first time — see [[06-incident-decisions-log]] and [[08-testing-log]]: the compiled entry point was at `dist/src/index.js`, not `dist/index.js`, invisible to every check except an actual deploy. Fixed before this deploy succeeded.
- `labour-app`'s very first build attempt failed with no usable logs and no diagnosis — retried once (via reconnecting the same source) and it succeeded with identical config, so treated as transient infra flakiness rather than a real bug. Worth remembering if it recurs.

See [[07-infrastructure-cost-and-migration]] for the full cost/reliability comparison against AWS/GCP and why we're staying on Neon/Railway for now.

## Plan-tier decision (open — neither provider's default tier has a real SLA)

- **Neon:** 99.95% monthly uptime SLA with tiered service credits only on the **Business or Scale plan** — Free/Launch carries no contractual guarantee at all.
- **Railway:** no published, standardized SLA for Hobby/Pro — a contractual SLA with remedies exists only on **Business Class/Enterprise**, negotiated case-by-case.
- Given this is a ₹450cr/year, ~4.5 lakh units/day line, decide explicitly which paid tier to run production on rather than defaulting to whatever tier the project starts on — flagged here for a decision, not yet made. Record the decision (and cost) in [[06-incident-decisions-log]] once picked.

## Rollback

TBD — document the actual rollback procedure the first time it's needed, with what worked and what didn't.
