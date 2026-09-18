---
tags: [ingestion, contract, status/proposed]
---

# Demand File Ingestion Contract (proposed — for review)

Related: [[03-data-model]]

The demand file arrives from an **external, untrusted source** on a recurring basis. This document defines the contract the ingestion pipeline enforces. Exact header names TBC from the source system — placeholders below use the columns confirmed in the kickoff spec.

## Expected format

- File type: CSV (or Excel — TBC once source is confirmed; pipeline should accept both via a shared parser).
- Required headers (case-insensitive match, exact names pending confirmation):
  - `FSN` — SKU code, non-empty string
  - `Darkstore` (or `DarkstoreId`) — non-empty string, must match a known darkstore in our reference list
  - `QtyRequired` — positive integer

## Validation rules (row-level)

A row is **rejected** (written to `demand_exceptions`, not inserted into `demand`) if any of:
- `FSN` is empty/null
- `Darkstore` is empty/null, or does not match a known darkstore code
- `QtyRequired` is missing, non-numeric, zero, or negative
- The row is an exact duplicate of another row already in the same file (same FSN + darkstore appearing twice) — flagged, not silently merged; admin decides via the exception report whether it's a source-system bug

A **file-level** reject (whole batch marked `failed`, nothing ingested) happens if:
- Required headers are missing entirely
- The file is empty (headers only, or truly empty)
- More than a configurable threshold (default 50%) of rows fail row-level validation — likely signals a format change upstream, not a few bad rows, so we stop and alert rather than partially ingest garbage

## Versioning & re-ingestion semantics

Each upload creates one `demand_batches` row and a new `demand_batch_id`. **Open question for product** (flagged in [[03-data-model]]): does the new file's demand *replace* the previous batch's outstanding demand, or *add to* it? Proposed default until confirmed: **replace** — i.e., the previous `demand_batch_id`'s unbatched remainder is considered superseded once a new file is successfully ingested, and the labour app only ever shows outstanding demand from the *current* `demand_batch_id`. All historical batches remain queryable for audit; nothing is deleted.

## Error reporting

On completion (success or partial failure), the admin panel shows:
- Total rows, valid rows, rejected rows, and a downloadable exception report (`demand_exceptions` for that `demand_batch_id`) with the original row content and rejection reason per row.
- If the file-level threshold trips, the batch is marked `failed`, previous demand stays live and untouched, and an alert fires (see monitoring in [[01-architecture]]).

## Never

- Never silently drop a row that fails validation without logging it to `demand_exceptions`.
- Never partially apply a batch that failed file-level validation — it's all-or-nothing at the batch level (individual row rejects within an otherwise-valid batch are fine and expected).
- Never overwrite `demand` rows in place — every ingestion is a new set of rows under a new `demand_batch_id`.
