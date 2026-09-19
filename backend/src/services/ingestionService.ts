import { parse } from "csv-parse/sync";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  validateHeaders,
  validateRows,
  validateSyncHeaders,
  validateSyncRows,
  type RawDemandRow,
} from "./ingestionValidation.js";
import { ValidationError } from "../lib/errors.js";

export interface IngestResult {
  demandBatchId: string;
  status: "completed" | "completed_with_errors" | "failed";
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  fileLevelError?: string;
}

/**
 * Ingests one demand file. Per docs/04-ingestion-contract.md: never partially
 * apply a batch that fails file-level validation (all-or-nothing at the file
 * level); row-level rejects within an otherwise-valid file are expected and
 * logged, never silently dropped.
 */
export async function ingestDemandFile(
  pool: Pool,
  fileBuffer: Buffer,
  filename: string,
  uploadedBy: string
): Promise<IngestResult> {
  let records: RawDemandRow[];
  try {
    records = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new ValidationError(`Could not parse file as CSV: ${(err as Error).message}`);
  }

  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const headerError = validateHeaders(headers);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchInsert = await client.query<{ id: string }>(
      `INSERT INTO demand_batches (source_filename, uploaded_by, status, total_rows)
       VALUES ($1, $2, 'processing', $3)
       RETURNING id`,
      [filename, uploadedBy, records.length]
    );
    const demandBatchId = batchInsert.rows[0]!.id;

    if (headerError) {
      await client.query(
        `UPDATE demand_batches SET status = 'failed', completed_at = now() WHERE id = $1`,
        [demandBatchId]
      );
      await client.query("COMMIT");
      return {
        demandBatchId,
        status: "failed",
        totalRows: records.length,
        validRows: 0,
        rejectedRows: 0,
        fileLevelError: headerError,
      };
    }

    const { validRows, rejectedRows, fileLevelError } = validateRows(records, null);

    if (fileLevelError) {
      await client.query(
        `UPDATE demand_batches SET status = 'failed', rejected_rows = $2, completed_at = now() WHERE id = $1`,
        [demandBatchId, rejectedRows.length]
      );
      await client.query("COMMIT");
      return {
        demandBatchId,
        status: "failed",
        totalRows: records.length,
        validRows: 0,
        rejectedRows: rejectedRows.length,
        fileLevelError,
      };
    }

    // Batch-inserted via unnest rather than one round trip per row — a real
    // demand file can have hundreds of rows, and awaiting them one at a time
    // over the network is slow enough to matter (and, in tests against a
    // real DB, slow enough to time out).
    if (validRows.length > 0) {
      await client.query(
        `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, batch_type, qty_required)
         SELECT $1, fsn, darkstore_id, 'shelf', qty_required
         FROM unnest($2::text[], $3::text[], $4::int[]) AS t(fsn, darkstore_id, qty_required)`,
        [
          demandBatchId,
          validRows.map((r) => r.fsn),
          validRows.map((r) => r.darkstoreId),
          validRows.map((r) => r.qtyRequired),
        ]
      );
    }

    if (rejectedRows.length > 0) {
      await client.query(
        `INSERT INTO demand_exceptions (demand_batch_id, raw_row, row_number, reason)
         SELECT $1, raw_row, row_number, reason
         FROM unnest($2::jsonb[], $3::int[], $4::text[]) AS t(raw_row, row_number, reason)`,
        [
          demandBatchId,
          rejectedRows.map((r) => JSON.stringify(r.rawRow)),
          rejectedRows.map((r) => r.rowNumber),
          rejectedRows.map((r) => r.reason),
        ]
      );
    }

    const status = rejectedRows.length > 0 ? "completed_with_errors" : "completed";
    await client.query(
      `UPDATE demand_batches
       SET status = $2, valid_rows = $3, rejected_rows = $4, completed_at = now()
       WHERE id = $1`,
      [demandBatchId, status, validRows.length, rejectedRows.length]
    );

    await client.query("COMMIT");
    return {
      demandBatchId,
      status,
      totalRows: records.length,
      validRows: validRows.length,
      rejectedRows: rejectedRows.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getLatestCompletedBatchId(pool: Pool): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM demand_batches
     WHERE status IN ('completed', 'completed_with_errors')
     ORDER BY created_at DESC LIMIT 1`
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Sync import — same shape as ingestDemandFile, plus a QtyFulfilled column
 * for migrating in demand that's already been partially/fully fulfilled in
 * a parent system before this one went live (docs/04-ingestion-contract.md
 * "Sync existing progress"). Each valid row with qtyFulfilled > 0 also gets
 * a batching_events row in the same transaction, attributed to the admin
 * running the sync — no new "system" user needed, since labour_id just
 * means "who's responsible for this ledger entry," and here that's
 * legitimately the admin doing the migration. Remaining-quantity math
 * downstream (FSN list, dashboard, darkstore drill-down) needs no special
 * case: it already derives everything from batching_events.
 */
export async function ingestSyncFile(
  pool: Pool,
  fileBuffer: Buffer,
  filename: string,
  uploadedBy: string
): Promise<IngestResult> {
  let records: RawDemandRow[];
  try {
    records = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new ValidationError(`Could not parse file as CSV: ${(err as Error).message}`);
  }

  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const headerError = validateSyncHeaders(headers);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const batchInsert = await client.query<{ id: string }>(
      `INSERT INTO demand_batches (source_filename, uploaded_by, status, total_rows)
       VALUES ($1, $2, 'processing', $3)
       RETURNING id`,
      [filename, uploadedBy, records.length]
    );
    const demandBatchId = batchInsert.rows[0]!.id;

    if (headerError) {
      await client.query(
        `UPDATE demand_batches SET status = 'failed', completed_at = now() WHERE id = $1`,
        [demandBatchId]
      );
      await client.query("COMMIT");
      return {
        demandBatchId,
        status: "failed",
        totalRows: records.length,
        validRows: 0,
        rejectedRows: 0,
        fileLevelError: headerError,
      };
    }

    const { validRows, rejectedRows, fileLevelError } = validateSyncRows(records, null);

    if (fileLevelError) {
      await client.query(
        `UPDATE demand_batches SET status = 'failed', rejected_rows = $2, completed_at = now() WHERE id = $1`,
        [demandBatchId, rejectedRows.length]
      );
      await client.query("COMMIT");
      return {
        demandBatchId,
        status: "failed",
        totalRows: records.length,
        validRows: 0,
        rejectedRows: rejectedRows.length,
        fileLevelError,
      };
    }

    if (validRows.length > 0) {
      await client.query(
        `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, batch_type, qty_required)
         SELECT $1, fsn, darkstore_id, 'shelf', qty_required
         FROM unnest($2::text[], $3::text[], $4::int[]) AS t(fsn, darkstore_id, qty_required)`,
        [
          demandBatchId,
          validRows.map((r) => r.fsn),
          validRows.map((r) => r.darkstoreId),
          validRows.map((r) => r.qtyRequired),
        ]
      );
    }

    const fulfilledRows = validRows.filter((r) => r.qtyFulfilled > 0);
    if (fulfilledRows.length > 0) {
      await client.query(
        `INSERT INTO batching_events (demand_batch_id, fsn, darkstore_id, batch_type, qty_batched, labour_id, client_request_id, source)
         SELECT $1, fsn, darkstore_id, 'shelf', qty_batched, $2, client_request_id, 'sync'
         FROM unnest($3::text[], $4::text[], $5::int[], $6::uuid[])
           AS t(fsn, darkstore_id, qty_batched, client_request_id)`,
        [
          demandBatchId,
          uploadedBy,
          fulfilledRows.map((r) => r.fsn),
          fulfilledRows.map((r) => r.darkstoreId),
          fulfilledRows.map((r) => r.qtyFulfilled),
          fulfilledRows.map(() => randomUUID()),
        ]
      );
    }

    if (rejectedRows.length > 0) {
      await client.query(
        `INSERT INTO demand_exceptions (demand_batch_id, raw_row, row_number, reason)
         SELECT $1, raw_row, row_number, reason
         FROM unnest($2::jsonb[], $3::int[], $4::text[]) AS t(raw_row, row_number, reason)`,
        [
          demandBatchId,
          rejectedRows.map((r) => JSON.stringify(r.rawRow)),
          rejectedRows.map((r) => r.rowNumber),
          rejectedRows.map((r) => r.reason),
        ]
      );
    }

    const status = rejectedRows.length > 0 ? "completed_with_errors" : "completed";
    await client.query(
      `UPDATE demand_batches
       SET status = $2, valid_rows = $3, rejected_rows = $4, completed_at = now()
       WHERE id = $1`,
      [demandBatchId, status, validRows.length, rejectedRows.length]
    );

    await client.query("COMMIT");
    return {
      demandBatchId,
      status,
      totalRows: records.length,
      validRows: validRows.length,
      rejectedRows: rejectedRows.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
