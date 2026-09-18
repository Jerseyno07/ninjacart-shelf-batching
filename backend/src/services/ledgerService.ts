import type { Pool, PoolClient } from "pg";
import { InsufficientRemainingError, NotFoundError } from "../lib/errors.js";

export interface BatchSubmission {
  darkstoreId: string;
  qtyBatched: number;
  clientRequestId: string;
}

export interface BatchSubmissionResult {
  darkstoreId: string;
  clientRequestId: string;
  status: "accepted" | "duplicate" | "rejected";
  reason?: string;
}

/**
 * Submits touched darkstore rows for an FSN as individual, independently
 * verified ledger writes (docs/03-data-model.md — batching_events). This is
 * deliberately NOT trusting the caller's FSN lock for correctness: every row
 * re-checks remaining demand inside its own transaction, so a stale client
 * re-submitting is caught even while it legitimately holds the lock.
 *
 * Only touched rows are ever passed in — untouched rows are never assumed to
 * be zero (see docs/00-overview.md partial-entry behavior).
 */
export async function submitBatch(
  pool: Pool,
  demandBatchId: string,
  fsn: string,
  labourId: string,
  submissions: BatchSubmission[]
): Promise<BatchSubmissionResult[]> {
  const results: BatchSubmissionResult[] = [];

  for (const submission of submissions) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await submitOne(client, demandBatchId, fsn, labourId, submission);
      await client.query("COMMIT");
      results.push(result);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err instanceof InsufficientRemainingError || err instanceof NotFoundError) {
        results.push({
          darkstoreId: submission.darkstoreId,
          clientRequestId: submission.clientRequestId,
          status: "rejected",
          reason: err.message,
        });
      } else {
        throw err;
      }
    } finally {
      client.release();
    }
  }

  return results;
}

async function submitOne(
  client: PoolClient,
  demandBatchId: string,
  fsn: string,
  labourId: string,
  submission: BatchSubmission
): Promise<BatchSubmissionResult> {
  // Idempotency: a retried client_request_id is a safe no-op, not a double insert.
  const existing = await client.query(
    `SELECT id FROM batching_events WHERE client_request_id = $1`,
    [submission.clientRequestId]
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return {
      darkstoreId: submission.darkstoreId,
      clientRequestId: submission.clientRequestId,
      status: "duplicate",
    };
  }

  // Atomic check-then-insert: re-verify remaining demand under a row lock,
  // independent of whatever FSN lock the caller holds.
  const remainingResult = await client.query<{ remaining: string; qty_required: number }>(
    `SELECT d.qty_required - COALESCE(SUM(be.qty_batched), 0) AS remaining, d.qty_required
     FROM demand d
     LEFT JOIN batching_events be
       ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id AND be.demand_batch_id = d.demand_batch_id
     WHERE d.fsn = $1 AND d.darkstore_id = $2 AND d.demand_batch_id = $3
     GROUP BY d.qty_required
     FOR UPDATE OF d`,
    [fsn, submission.darkstoreId, demandBatchId]
  );

  const row = remainingResult.rows[0];
  if (!row) {
    throw new NotFoundError(
      `No demand row for FSN ${fsn} / darkstore ${submission.darkstoreId} in this demand batch`
    );
  }

  const remaining = Number(row.remaining);
  if (submission.qtyBatched > remaining) {
    throw new InsufficientRemainingError(
      `Requested ${submission.qtyBatched} exceeds remaining ${remaining} for darkstore ${submission.darkstoreId}`
    );
  }

  await client.query(
    `INSERT INTO batching_events (demand_batch_id, fsn, darkstore_id, batch_type, qty_batched, labour_id, client_request_id)
     VALUES ($1, $2, $3, 'shelf', $4, $5, $6)`,
    [demandBatchId, fsn, submission.darkstoreId, submission.qtyBatched, labourId, submission.clientRequestId]
  );

  return {
    darkstoreId: submission.darkstoreId,
    clientRequestId: submission.clientRequestId,
    status: "accepted",
  };
}

export interface FsnSummary {
  fsn: string;
  totalRemaining: number;
  darkstoreCount: number;
}

/** FSN list screen: total remaining qty across darkstores, per FSN. */
export async function listFsnSummaries(pool: Pool, demandBatchId: string): Promise<FsnSummary[]> {
  const result = await pool.query<{ fsn: string; total_remaining: string; darkstore_count: string }>(
    `SELECT d.fsn,
            SUM(d.qty_required - COALESCE(be.batched, 0)) AS total_remaining,
            COUNT(*) AS darkstore_count
     FROM demand d
     LEFT JOIN (
       SELECT fsn, darkstore_id, SUM(qty_batched) AS batched
       FROM batching_events
       WHERE demand_batch_id = $1
       GROUP BY fsn, darkstore_id
     ) be ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id
     WHERE d.demand_batch_id = $1
     GROUP BY d.fsn
     HAVING SUM(d.qty_required - COALESCE(be.batched, 0)) > 0
     ORDER BY d.fsn`,
    [demandBatchId]
  );

  return result.rows.map((r) => ({
    fsn: r.fsn,
    totalRemaining: Number(r.total_remaining),
    darkstoreCount: Number(r.darkstore_count),
  }));
}

export interface DarkstoreRow {
  darkstoreId: string;
  qtyRequired: number;
  qtyBatched: number;
  remaining: number;
}

/** Darkstore list screen for one FSN, opened only while its lock is held. */
export async function listDarkstoresForFsn(
  pool: Pool,
  demandBatchId: string,
  fsn: string
): Promise<DarkstoreRow[]> {
  const result = await pool.query<{
    darkstore_id: string;
    qty_required: number;
    qty_batched: string;
  }>(
    `SELECT d.darkstore_id, d.qty_required, COALESCE(SUM(be.qty_batched), 0) AS qty_batched
     FROM demand d
     LEFT JOIN batching_events be
       ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id AND be.demand_batch_id = d.demand_batch_id
     WHERE d.fsn = $1 AND d.demand_batch_id = $2
     GROUP BY d.darkstore_id, d.qty_required
     ORDER BY d.darkstore_id`,
    [fsn, demandBatchId]
  );

  return result.rows.map((r) => ({
    darkstoreId: r.darkstore_id,
    qtyRequired: r.qty_required,
    qtyBatched: Number(r.qty_batched),
    remaining: r.qty_required - Number(r.qty_batched),
  }));
}
