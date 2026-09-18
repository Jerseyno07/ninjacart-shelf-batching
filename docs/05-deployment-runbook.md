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

## Rollback

TBD — document the actual rollback procedure the first time it's needed, with what worked and what didn't.
