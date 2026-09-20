import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { getDashboardMetrics } from "../src/services/dashboardService.js";

/**
 * Requires TEST_DATABASE_URL with migrations applied. Scoped to the latest
 * successfully ingested demand batch, same as dashboardService.integration.test.ts.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("getDashboardMetrics (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let labourAId: string;
  let labourBId: string;
  let demandBatchId: string;
  const fsn = `TEST-FSN-METRICS-${Date.now()}`;
  const darkstoreA = `TEST-DS-METRICS-A-${Date.now()}`;
  const darkstoreB = `TEST-DS-METRICS-B-${Date.now()}`;

  beforeAll(async () => {
    const userA = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('Labour A', $1, 'x', 'labour') RETURNING id`,
      [`metrics-labour-a-${Date.now()}`]
    );
    labourAId = userA.rows[0].id;
    const userB = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('Labour B', $1, 'x', 'labour') RETURNING id`,
      [`metrics-labour-b-${Date.now()}`]
    );
    labourBId = userB.rows[0].id;

    const batch = await pool.query(
      `INSERT INTO demand_batches (source_filename, uploaded_by, status) VALUES ('metrics.csv', $1, 'completed') RETURNING id`,
      [labourAId]
    );
    demandBatchId = batch.rows[0].id;

    // darkstoreA: fully completed (100/100). darkstoreB: partially (30/100).
    await pool.query(
      `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, qty_required) VALUES ($1, $2, $3, 100)`,
      [demandBatchId, fsn, darkstoreA]
    );
    await pool.query(
      `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, qty_required) VALUES ($1, $2, $3, 100)`,
      [demandBatchId, fsn, darkstoreB]
    );

    // Labour A batches 100 (source=labour) at darkstoreA -> fully complete.
    await pool.query(
      `INSERT INTO batching_events (demand_batch_id, fsn, darkstore_id, qty_batched, labour_id, client_request_id, source)
       VALUES ($1, $2, $3, 100, $4, $5, 'labour')`,
      [demandBatchId, fsn, darkstoreA, labourAId, randomUUID()]
    );
    // Labour B batches 20 (source=labour) at darkstoreB.
    await pool.query(
      `INSERT INTO batching_events (demand_batch_id, fsn, darkstore_id, qty_batched, labour_id, client_request_id, source)
       VALUES ($1, $2, $3, 20, $4, $5, 'labour')`,
      [demandBatchId, fsn, darkstoreB, labourBId, randomUUID()]
    );
    // A sync-seeded event at darkstoreB -- must count toward completion but
    // NOT toward labour productivity.
    await pool.query(
      `INSERT INTO batching_events (demand_batch_id, fsn, darkstore_id, qty_batched, labour_id, client_request_id, source)
       VALUES ($1, $2, $3, 10, $4, $5, 'sync')`,
      [demandBatchId, fsn, darkstoreB, labourAId, randomUUID()]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM batching_events WHERE fsn = $1`, [fsn]);
    await pool.query(`DELETE FROM demand WHERE fsn = $1`, [fsn]);
    await pool.query(`DELETE FROM demand_batches WHERE id = $1`, [demandBatchId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[labourAId, labourBId]]);
    await pool.end();
  });

  it("aggregates labour productivity from source='labour' events only, excluding sync-seeded ones", async () => {
    const metrics = await getDashboardMetrics(pool);
    expect(metrics.demandBatchId).toBe(demandBatchId);

    const labourA = metrics.labourProductivity.find((r) => r.labourId === labourAId);
    const labourB = metrics.labourProductivity.find((r) => r.labourId === labourBId);
    // Labour A's 100 (labour) counts; the 10 (sync, also attributed to A) must not.
    expect(labourA?.unitsBatched).toBe(100);
    expect(labourB?.unitsBatched).toBe(20);
  });

  it("computes per-darkstore completion percentage across all FSNs", async () => {
    const metrics = await getDashboardMetrics(pool);
    const dsA = metrics.darkstoreCompletion.find((r) => r.darkstoreId === darkstoreA);
    const dsB = metrics.darkstoreCompletion.find((r) => r.darkstoreId === darkstoreB);
    expect(dsA).toEqual({ darkstoreId: darkstoreA, required: 100, batched: 100, percentComplete: 100 });
    expect(dsB).toEqual({ darkstoreId: darkstoreB, required: 100, batched: 30, percentComplete: 30 });
  });

  it("classifies the FSN as in-progress (not fully batched, not untouched)", async () => {
    const metrics = await getDashboardMetrics(pool);
    // The single test FSN spans both darkstores: 200 required, 130 batched overall.
    expect(metrics.fsnBreakdown.inProgress).toBeGreaterThanOrEqual(1);
  });
});
