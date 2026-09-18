import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { getDashboardSummary } from "../src/services/dashboardService.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("dashboardService (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let labourId: string;
  let demandBatchId: string;
  const fsn = `TEST-FSN-DASH-${Date.now()}`;
  const darkstoreId = `TEST-DS-DASH-${Date.now()}`;

  beforeAll(async () => {
    const user = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('D', $1, 'x', 'labour') RETURNING id`,
      [`dash-labour-${Date.now()}`]
    );
    labourId = user.rows[0].id;

    const batch = await pool.query(
      `INSERT INTO demand_batches (source_filename, uploaded_by, status) VALUES ('dash.csv', $1, 'completed') RETURNING id`,
      [labourId]
    );
    demandBatchId = batch.rows[0].id;

    await pool.query(
      `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, qty_required) VALUES ($1, $2, $3, 100)`,
      [demandBatchId, fsn, darkstoreId]
    );

    await pool.query(
      `INSERT INTO batching_events (demand_batch_id, fsn, darkstore_id, qty_batched, labour_id, client_request_id)
       VALUES ($1, $2, $3, 40, $4, $5)`,
      [demandBatchId, fsn, darkstoreId, labourId, randomUUID()]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM batching_events WHERE fsn = $1`, [fsn]);
    await pool.query(`DELETE FROM demand WHERE fsn = $1`, [fsn]);
    await pool.query(`DELETE FROM demand_batches WHERE id = $1`, [demandBatchId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [labourId]);
    await pool.end();
  });

  it("reports the latest ingestion and completion percentage derived from the ledger", async () => {
    const summary = await getDashboardSummary(pool);
    expect(summary.latestIngestion?.batchId).toBe(demandBatchId);
    expect(summary.completion?.demandBatchId).toBe(demandBatchId);
    expect(summary.completion?.totalRequired).toBeGreaterThanOrEqual(100);
    expect(summary.completion?.totalBatched).toBeGreaterThanOrEqual(40);
    expect(summary.activeLockCount).toBeGreaterThanOrEqual(0);
  });
});
