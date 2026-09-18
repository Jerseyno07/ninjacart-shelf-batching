---
tags: [overview]
---

# Overview

Shelf Batching system: warehouse labour fulfil SKU-wise (FSN) demand across darkstores. Phase 1 of a larger warehouse tooling initiative — full-lot ("SS") batching is explicitly out of scope for now but the data model ([[03-data-model]]) reserves a `batch_type` discriminator so it can be added later without a rewrite.

Business context: underpins a ~₹450 crore/year line moving ~4.5 lakh units/day. Correctness, auditability, and uptime are first-class, not nice-to-haves.

## Vault map

- [[01-architecture]] — system shape, stack, offline model
- [[02-adr-001-fsn-level-locking]] — the concurrency decision (read this first if touching locking/batching code)
- [[03-data-model]] — schema
- [[04-ingestion-contract]] — demand file format & validation
- [[05-deployment-runbook]] — Railway/Neon deploy steps
- [[06-incident-decisions-log]] — append-only log of decisions and incidents, updated as they happen
- [[07-infrastructure-cost-and-migration]] — why Neon/Railway, cost/reliability comparison vs AWS/GCP, and the migration path if we switch later
- [[08-testing-log]] — every check actually run against the code (lint/typecheck/build/unit/integration/manual), exact test cases, and results — including the two real bugs only a live-database run caught

## Sibling project

[[../CLAUDE.md|CLAUDE.md]] carries forward stack/workflow learnings from PackTrack Pro (a prior, separate Ninjacart warehouse project by the same owner) — read it before making conventions-related decisions.
