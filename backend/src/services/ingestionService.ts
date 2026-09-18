import { parse } from "csv-parse/sync";
import type { Pool } from "pg";
import { validateHeaders, validateRows, type RawDemandRow } from "./ingestionValidation.js";
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

    for (const row of validRows) {
      await client.query(
        `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, batch_type, qty_required)
         VALUES ($1, $2, $3, 'shelf', $4)`,
        [demandBatchId, row.fsn, row.darkstoreId, row.qtyRequired]
      );
    }

    for (const rejected of rejectedRows) {
      await client.query(
        `INSERT INTO demand_exceptions (demand_batch_id, raw_row, row_number, reason)
         VALUES ($1, $2, $3, $4)`,
        [demandBatchId, JSON.stringify(rejected.rawRow), rejected.rowNumber, rejected.reason]
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
