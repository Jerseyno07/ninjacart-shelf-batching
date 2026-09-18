---
tags: [ingestion, contract, status/proposed]
---

# Demand File Ingestion Contract (proposed — for review)

Related: [[03-data-model]]

The demand file arrives from an **external, untrusted source** on a recurring basis. This document defines the contract the ingestion pipeline enforces. Exact header names TBC from the source system — the schema below is a **working dummy schema**, implemented and tested end-to-end (`backend/src/services/ingestionValidation.ts`, `backend/test/fixtures/`), to be swapped for the real headers once confirmed.

## Expected format (dummy schema — pending real source confirmation)

- File type: CSV (or Excel — TBC once source is confirmed; pipeline should accept both via a shared parser).
- Required headers (case-insensitive match, exact names pending confirmation):
  - `FSN` — SKU code, non-empty string. Example: `FSN-APPLE-001`.
  - `Darkstore` — non-empty string identifying the darkstore. Example: `DS-KOR-01`.
  - `QtyRequired` — positive integer.
- Sample fixtures in `backend/test/fixtures/`: `sample-demand-valid.csv` (clean file), `sample-demand-few-errors.csv` (a couple of bad rows, under the file-level threshold), `sample-demand-with-errors.csv` (majority bad, trips the file-level reject).
- **Known gap:** the contract calls for `Darkstore` to be checked against a reference list of known darkstore codes — not yet enforced (`ingestionValidation.ts` currently accepts any non-empty darkstore id, since no darkstore master list exists yet). Wire this up once that list exists; until then, a typo'd darkstore code will be silently accepted as valid rather than rejected as `unknown_darkstore`.

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
