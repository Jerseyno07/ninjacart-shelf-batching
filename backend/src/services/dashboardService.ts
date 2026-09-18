import type { Pool } from "pg";

export interface DashboardSummary {
  latestIngestion: {
    batchId: string;
    filename: string;
    status: string;
    totalRows: number;
    validRows: number;
    rejectedRows: number;
    createdAt: string;
  } | null;
  completion: {
    demandBatchId: string;
    totalRequired: number;
    totalBatched: number;
    percentComplete: number;
  } | null;
  activeLockCount: number;
}

/**
 * One aggregate for the admin dashboard's headline stats. "Latest ingestion"
 * is the most recent upload regardless of outcome (so a failed upload is
 * visible); "completion" is scoped to the latest successfully ingested
 * batch, since that's the one demand actually being worked against.
 */
export async function getDashboardSummary(pool: Pool): Promise<DashboardSummary> {
  const latestIngestionResult = await pool.query(
    `SELECT id, source_filename, status, total_rows, valid_rows, rejected_rows, created_at
     FROM demand_batches ORDER BY created_at DESC LIMIT 1`
  );
  const latestIngestionRow = latestIngestionResult.rows[0];

  const currentBatchResult = await pool.query<{ id: string }>(
    `SELECT id FROM demand_batches
     WHERE status IN ('completed', 'completed_with_errors')
     ORDER BY created_at DESC LIMIT 1`
  );
  const currentBatchId = currentBatchResult.rows[0]?.id ?? null;

  let completion: DashboardSummary["completion"] = null;
  if (currentBatchId) {
    const totals = await pool.query<{ total_required: string; total_batched: string }>(
      `SELECT
         COALESCE(SUM(d.qty_required), 0) AS total_required,
         COALESCE(SUM(be.batched), 0) AS total_batched
       FROM demand d
       LEFT JOIN (
         SELECT fsn, darkstore_id, SUM(qty_batched) AS batched
         FROM batching_events
         WHERE demand_batch_id = $1
         GROUP BY fsn, darkstore_id
       ) be ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id
       WHERE d.demand_batch_id = $1`,
      [currentBatchId]
    );
    const totalRequired = Number(totals.rows[0]!.total_required);
    const totalBatched = Number(totals.rows[0]!.total_batched);
    completion = {
      demandBatchId: currentBatchId,
      totalRequired,
      totalBatched,
      percentComplete: totalRequired > 0 ? Math.round((totalBatched / totalRequired) * 1000) / 10 : 0,
    };
  }

  const activeLocksResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM fsn_locks WHERE released_at IS NULL AND expires_at >= now()`
  );

  return {
    latestIngestion: latestIngestionRow
      ? {
          batchId: latestIngestionRow.id,
          filename: latestIngestionRow.source_filename,
          status: latestIngestionRow.status,
          totalRows: latestIngestionRow.total_rows,
          validRows: latestIngestionRow.valid_rows,
          rejectedRows: latestIngestionRow.rejected_rows,
          createdAt: latestIngestionRow.created_at,
        }
      : null,
    completion,
    activeLockCount: Number(activeLocksResult.rows[0]!.count),
  };
}
