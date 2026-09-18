---
tags: [runbook, status/stub]
---

# Deployment Runbook (stub)

To be filled in once the stack ([[01-architecture]]) is confirmed and the first deploy happens — filling this in retroactively after the fact is exactly the habit we're avoiding this time, so update it the first time a deploy step is actually run, not after.

## Planned shape (matching PackTrack Pro's pattern)

- Railway project, auto-deploy from `main`.
- Neon Postgres, connection string in Railway env vars (never committed — see [[../CONTRIBUTING.md|CONTRIBUTING]]).
- Migrations: reversible, reviewed in PR before merge — this data cannot be casually reset in production. Every migration ships with a paired down-migration.
- Env vars needed: TBD, list them here as they're added.

See [[07-infrastructure-cost-and-migration]] for the full cost/reliability comparison against AWS/GCP and why we're staying on Neon/Railway for now.

## Plan-tier decision (open — neither provider's default tier has a real SLA)

- **Neon:** 99.95% monthly uptime SLA with tiered service credits only on the **Business or Scale plan** — Free/Launch carries no contractual guarantee at all.
- **Railway:** no published, standardized SLA for Hobby/Pro — a contractual SLA with remedies exists only on **Business Class/Enterprise**, negotiated case-by-case.
- Given this is a ₹450cr/year, ~4.5 lakh units/day line, decide explicitly which paid tier to run production on rather than defaulting to whatever tier the project starts on — flagged here for a decision, not yet made. Record the decision (and cost) in [[06-incident-decisions-log]] once picked.

## Rollback

TBD — document the actual rollback procedure the first time it's needed, with what worked and what didn't.
