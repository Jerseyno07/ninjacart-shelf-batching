---
tags: [infrastructure, cost, migration, status/decided-for-now]
---

# Infrastructure Choice, Cost, and Migration Path

Related: [[01-architecture]], [[05-deployment-runbook]]

**Decision as of 2026-09-18: stay on Neon + Railway for now.** Not because it's the most reliable option available — it isn't — but because nothing in the codebase locks us into it, so the switching cost later is low and the operational simplicity now is worth more than the SLA gap while the system is still being built and load-tested. This doc records the comparison so that decision can be revisited on real information (actual load numbers, real usage cost) rather than re-argued from scratch.

## Why Neon + Railway in the first place

Not a reliability judgment — inherited from PackTrack Pro's already-working deploy pattern (same owner, same infra habits, low switching cost). The original project kickoff called **Postgres the engine** "non-negotiable" for transactional integrity — that's relational-vs-NoSQL, not Neon-vs-other-Postgres-hosts. Railway came along as "the platform PackTrack already runs on," not because it was benchmarked against alternatives.

## Reliability comparison

| Stack | DB SLA | Compute SLA | Track record |
|---|---|---|---|
| **Neon (Scale) + Railway (Business Class)** | 99.95% | No public standardized figure below Business Class/Enterprise (negotiated case-by-case) | Both relatively young platforms (Neon ~2021, Railway ~2020) at this production scale |
| **AWS Aurora PostgreSQL + Fargate** | 99.99% (Multi-AZ) | No dedicated Fargate SLA; wrapped into AWS's general compute SLAs, effectively 99.95%+ | Over a decade in production at massive scale |
| **AWS RDS PostgreSQL (Multi-AZ) + Fargate** | 99.95% | same as above | Same maturity, simpler DB architecture than Aurora |
| **GCP Cloud SQL (Enterprise Plus) + Cloud Run** | 99.99% (near-zero-downtime maintenance) | Cloud Run has its own published SLA, generally 99.95% | Cloud SQL is mature; Cloud Run is newer but backed by Google's broader infra track record |

Sources: [Neon SLA](https://neon.com/neon-business-sla), [AWS RDS SLA](https://aws.amazon.com/rds/sla/), [AWS Aurora SLA](https://aws.amazon.com/rds/aurora/sla), [Google Cloud SQL SLA](https://cloud.google.com/sql/sla), [Railway SLA discussion](https://station.railway.com/questions/railway-s-sl-as-b851c079) (checked 2026-09-18 — verify again before actually acting on this table, since provider terms change).

## Cost comparison (order-of-magnitude estimate, not a quote)

These are ballpark monthly figures for a workload like ours (100+ concurrent labourers, 5–10s polling, a 24/7 production API + DB) — **not** based on real load-test numbers, since none exist yet. Treat as "which order of magnitude" rather than a budget line.

| Stack | Rough monthly cost | What drives it |
|---|---|---|
| **Neon (Scale) + Railway (Pro/Business)** | ~$250–450 | Neon: ~$0.222/CU-hr, so 1–2 CU sustained ≈ $160–320 + storage/egress. Railway: $20 base + per-vCPU/RAM usage ≈ $50–100 for the backend. |
| **AWS Aurora/RDS (Multi-AZ) + Fargate** | ~$450–600+ | Multi-AZ **doubles** the DB instance cost (a full synchronous standby) — a modest `db.r6g.large` Multi-AZ alone runs ~$380–440/month. Add Fargate (~$30–60/month for a small task) + ALB (~$16/month) + NAT gateway if needed (~$32/month). |
| **GCP Cloud SQL (Enterprise Plus, HA) + Cloud Run** | ~$250–400 | HA roughly doubles the Cloud SQL instance cost too, but Cloud Run's generous free tier and per-request billing keep compute cheap at this request volume; committed-use discounts can cut Cloud SQL further (~40% at 1yr commit). |

**The pattern:** AWS's Multi-AZ premium (paying for a full standby instance) and networking overhead (ALB, NAT) are the biggest cost gap vs. Neon/Railway, which bake high availability into the base price and hide the networking entirely. GCP sits in between — similar HA cost structure to AWS, but Cloud Run's pricing is closer to Railway's simplicity.

Sources: [Neon pricing](https://neon.com/pricing), [Railway pricing](https://railway.com/pricing), [AWS RDS pricing](https://aws.amazon.com/rds/pricing/), [Google Cloud SQL pricing](https://cloud.google.com/sql/pricing) (checked 2026-09-18).

## Pros and cons

### Neon + Railway (current)
**Pros:** lowest operational overhead — no VPC/IAM/networking to configure; "git push and it's live"; matches PackTrack Pro's already-proven pattern for this owner; cheapest at current, unvalidated load estimates; Neon's branching model is genuinely useful for a `TEST_DATABASE_URL` disposable test DB (already relied on in `backend/README.md`).
**Cons:** shorter production track record at this class of workload than AWS/GCP; Railway has no public SLA below Business Class/Enterprise; SLA-backed tiers require upgrading from whatever the project starts on (see [[05-deployment-runbook]] — still an open decision).

### AWS (Aurora/RDS + Fargate)
**Pros:** highest DB SLA (99.99% on Aurora); longest, deepest production track record of any option here; same-VPC low-latency DB↔compute networking; largest ecosystem for hiring/support/tooling if the team grows.
**Cons:** real operational complexity — VPC, IAM, security groups, NAT gateways are all things that can be misconfigured and are currently abstracted away entirely by Railway/Neon; highest cost of the three, driven by the Multi-AZ standby + networking overhead; steepest ramp-up for a small team that's never run AWS infra before.

### GCP (Cloud SQL Enterprise Plus + Cloud Run)
**Pros:** same 99.99%-class SLA tier as AWS; generally considered simpler to operate than raw AWS while still being a major cloud provider; Cloud Run's pricing/scaling model is closer to what Railway already feels like, so the mental-model jump is smaller than jumping to AWS.
**Cons:** still real infra to set up (VPC connector for Cloud Run↔Cloud SQL, IAM) that doesn't exist today; smaller ecosystem/precedent at Ninjacart than AWS would have, if that matters for hiring/support later.

## What we've already done to keep a future migration cheap

None of this was done *for* migration specifically — it's just how the backend was built per [[01-architecture]] — but it happens to make switching providers later low-risk:

1. **Raw SQL (`pg`), no ORM.** Every query in `lockService.ts` / `ledgerService.ts` / `ingestionService.ts` is plain parameterized Postgres SQL. No ORM-specific dialect quirks, no vendor Postgres extensions used at runtime (no Neon branching API calls, no proprietary functions). Moving the schema and data to RDS/Aurora/Cloud SQL is a standard `pg_dump`/`pg_restore` or logical-replication job — the application code doesn't change at all beyond the connection string.
2. **No Railway SDK or Railway-specific API calls anywhere in the code.** The backend is a plain Node process reading `process.env` (`backend/src/config.ts`) — it has no idea it's running on Railway. It would run identically on any container platform.
3. **`backend/Dockerfile` (added in this change).** Railway currently builds the backend automatically via Nixpacks, without needing a Dockerfile. AWS Fargate and GCP Cloud Run both require a container image, so this file exists purely as that hedge — multi-stage build, production-only dependencies in the runtime image. **Not yet verified with a real `docker build`** — no Docker available in the environment this was written in; verify before actually deploying to a container platform.
4. **Env-var-driven config end to end** (`backend/.env.example`, `config.ts` with zod validation) — every environment-specific value (`DATABASE_URL`, `JWT_SECRET`, `SENTRY_DSN`, etc.) is externalized already, which is exactly the shape any new platform's secrets manager expects.

## Migration risks (if/when this happens)

- **Data cutover window.** The DB migration itself needs either (a) a maintenance window with a final `pg_dump`/`pg_restore`, accepting some downtime, or (b) logical replication set up in advance with a monitored switchover once replication lag is ~0 — more work, less downtime. For a live ledger this cannot be casually "just switch it," per [[05-deployment-runbook]]'s existing rule that this data cannot be casually reset in production.
- **Connection behavior differences.** Neon's serverless connections (including pooling behavior, cold-start on scale-to-zero) differ from a traditional always-on RDS/Cloud SQL connection pool. `pool.ts`'s `max: 20` and pooling assumptions should be re-checked against whichever provider is picked, not assumed to carry over unchanged.
- **Networking setup is a first-time thing, not a copy-paste.** VPC/IAM/security-group configuration for AWS, or VPC connector + IAM for GCP Cloud Run↔Cloud SQL, is new work for this team — a misconfiguration here (an open security group, a wrong IAM policy) is a real security risk, not just a reliability one. This should get its own review, not be rushed alongside a switchover.
- **Testing surface.** All the integration tests gated on `TEST_DATABASE_URL` (`backend/test/*.integration.test.ts`) need to actually pass against the new provider before cutover — don't assume "it's just Postgres" without running them.
- **Cost surprise risk.** The Multi-AZ doubling on AWS/GCP is easy to underestimate if sizing is copy-pasted from a Neon compute-unit budget without accounting for the standby instance — get a real quote for the actual instance size needed, not the ballpark table above, before committing budget.
- **Rollback plan.** Whatever the cutover approach, have a tested way back to the old provider (or at minimum a verified recent backup) until the new one has run through at least one full production cycle (a day's ingestion + batching load) without incident.

## Revisit trigger

Revisit this decision once real load-test numbers exist (from actually running the labour app + backend under realistic concurrent load) or before the production go-live at full ₹450cr/4.5-lakh-units/day volume — whichever comes first. Record the actual decision and reasoning in [[06-incident-decisions-log]] when that happens, not just here.
