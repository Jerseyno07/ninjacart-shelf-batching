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

export interface LabourProductivityRow {
  labourId: string;
  labourName: string;
  unitsBatched: number;
  submissionCount: number;
}

export interface DarkstoreCompletionRow {
  darkstoreId: string;
  required: number;
  batched: number;
  percentComplete: number;
}

export interface FsnBreakdown {
  completed: number;
  inProgress: number;
  notStarted: number;
  total: number;
}

export interface DashboardMetrics {
  demandBatchId: string | null;
  labourProductivity: LabourProductivityRow[];
  darkstoreCompletion: DarkstoreCompletionRow[];
  fsnBreakdown: FsnBreakdown;
}

/**
 * Extended OPS-dashboard metrics, scoped to the latest successfully
 * ingested demand batch (same scoping as `completion` above, since that's
 * the demand actually being worked against). `labourProductivity` counts
 * only source = 'labour' events — a sync-seeded row isn't someone on the
 * floor doing work, so it shouldn't inflate a labourer's throughput (see
 * docs/06-incident-decisions-log.md, the `source` column decision).
 */
export async function getDashboardMetrics(pool: Pool): Promise<DashboardMetrics> {
  const currentBatchResult = await pool.query<{ id: string }>(
    `SELECT id FROM demand_batches
     WHERE status IN ('completed', 'completed_with_errors')
     ORDER BY created_at DESC LIMIT 1`
  );
  const demandBatchId = currentBatchResult.rows[0]?.id ?? null;

  if (!demandBatchId) {
    return {
      demandBatchId: null,
      labourProductivity: [],
      darkstoreCompletion: [],
      fsnBreakdown: { completed: 0, inProgress: 0, notStarted: 0, total: 0 },
    };
  }

  const productivityResult = await pool.query<{
    labour_id: string;
    labour_name: string;
    units_batched: string;
    submission_count: string;
  }>(
    `SELECT be.labour_id, u.name AS labour_name,
            SUM(be.qty_batched) AS units_batched,
            COUNT(*) AS submission_count
     FROM batching_events be
     JOIN users u ON u.id = be.labour_id
     WHERE be.demand_batch_id = $1 AND be.source = 'labour'
     GROUP BY be.labour_id, u.name
     ORDER BY units_batched DESC`,
    [demandBatchId]
  );
  const labourProductivity: LabourProductivityRow[] = productivityResult.rows.map((r) => ({
    labourId: r.labour_id,
    labourName: r.labour_name,
    unitsBatched: Number(r.units_batched),
    submissionCount: Number(r.submission_count),
  }));

  const darkstoreResult = await pool.query<{
    darkstore_id: string;
    required: string;
    batched: string;
  }>(
    `SELECT d.darkstore_id,
            SUM(d.qty_required) AS required,
            COALESCE(SUM(be.batched), 0) AS batched
     FROM demand d
     LEFT JOIN (
       SELECT fsn, darkstore_id, SUM(qty_batched) AS batched
       FROM batching_events
       WHERE demand_batch_id = $1
       GROUP BY fsn, darkstore_id
     ) be ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id
     WHERE d.demand_batch_id = $1
     GROUP BY d.darkstore_id
     ORDER BY d.darkstore_id`,
    [demandBatchId]
  );
  const darkstoreCompletion: DarkstoreCompletionRow[] = darkstoreResult.rows.map((r) => {
    const required = Number(r.required);
    const batched = Number(r.batched);
    return {
      darkstoreId: r.darkstore_id,
      required,
      batched,
      percentComplete: required > 0 ? Math.round((batched / required) * 1000) / 10 : 0,
    };
  });

  const fsnResult = await pool.query<{ required: string; batched: string }>(
    `SELECT SUM(d.qty_required) AS required, COALESCE(SUM(be.batched), 0) AS batched
     FROM demand d
     LEFT JOIN (
       SELECT fsn, darkstore_id, SUM(qty_batched) AS batched
       FROM batching_events
       WHERE demand_batch_id = $1
       GROUP BY fsn, darkstore_id
     ) be ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id
     WHERE d.demand_batch_id = $1
     GROUP BY d.fsn`,
    [demandBatchId]
  );
  const fsnBreakdown: FsnBreakdown = { completed: 0, inProgress: 0, notStarted: 0, total: fsnResult.rows.length };
  for (const row of fsnResult.rows) {
    const required = Number(row.required);
    const batched = Number(row.batched);
    if (batched >= required) fsnBreakdown.completed += 1;
    else if (batched > 0) fsnBreakdown.inProgress += 1;
    else fsnBreakdown.notStarted += 1;
  }

  return { demandBatchId, labourProductivity, darkstoreCompletion, fsnBreakdown };
}
