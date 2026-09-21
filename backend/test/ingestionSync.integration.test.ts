import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSyncFile } from "../src/services/ingestionService.js";

/**
 * Requires TEST_DATABASE_URL with migrations applied. Exercises the sync
 * import pipeline against test/fixtures/sample-sync-valid.csv — see
 * docs/04-ingestion-contract.md "Sync existing progress".
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe.skipIf(!databaseUrl)("ingestSyncFile (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let adminId: string;

  beforeAll(async () => {
    const user = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('Sync Admin', $1, 'x', 'admin') RETURNING id`,
      [`sync-admin-${Date.now()}`]
    );
    adminId = user.rows[0].id;
  });

  afterAll(async () => {
    const batches = await pool.query(`SELECT id FROM demand_batches WHERE uploaded_by = $1`, [
      adminId,
    ]);
    for (const { id } of batches.rows) {
      await pool.query(`DELETE FROM batching_events WHERE demand_batch_id = $1`, [id]);
      await pool.query(`DELETE FROM demand_exceptions WHERE demand_batch_id = $1`, [id]);
      await pool.query(`DELETE FROM demand WHERE demand_batch_id = $1`, [id]);
    }
    await pool.query(`DELETE FROM demand_batches WHERE uploaded_by = $1`, [adminId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [adminId]);
    await pool.end();
  });

  it("seeds the ledger with already-fulfilled quantity, attributed to the syncing admin", async () => {
    const buffer = readFileSync(path.join(fixturesDir, "sample-sync-valid.csv"));
    const result = await ingestSyncFile(pool, buffer, "sample-sync-valid.csv", adminId);

    expect(result.status).toBe("completed");
    expect(result.validRows).toBe(5);
    expect(result.rejectedRows).toBe(0);

    // The one row with QtyFulfilled = 0 must NOT get a ledger row at all —
    // untouched, not a zero-value entry (4 of the 5 rows have fulfilled > 0).
    const events = await pool.query(
      `SELECT fsn, darkstore_id, qty_batched, labour_id FROM batching_events
       WHERE demand_batch_id = $1 ORDER BY darkstore_id`,
      [result.demandBatchId]
    );
    expect(events.rows).toHaveLength(4);
    expect(events.rows.every((r) => r.labour_id === adminId)).toBe(true);

    // Remaining is correctly derived: 40/40 required batched -> 0 remaining.
    const remaining = await pool.query<{ remaining: string }>(
      `SELECT d.qty_required - COALESCE(SUM(be.qty_batched), 0) AS remaining
       FROM demand d
       LEFT JOIN batching_events be ON be.fsn = d.fsn AND be.darkstore_id = d.darkstore_id AND be.demand_batch_id = d.demand_batch_id
       WHERE d.fsn = 'FSN-APPLE-001' AND d.darkstore_id = 'DS-KOR-01' AND d.demand_batch_id = $1
       GROUP BY d.qty_required`,
      [result.demandBatchId]
    );
    expect(Number(remaining.rows[0]?.remaining)).toBe(0);
  });

  it("fails the whole file when a row's QtyFulfilled exceeds QtyRequired: no demand, no ledger entries", async () => {
    const csv = Buffer.from(
      "FSN,Darkstore,QtyRequired,QtyFulfilled\n" +
        "FSN-X,DS-1,10,5\n" +
        "FSN-Y,DS-1,10,99\n"
    );
    const result = await ingestSyncFile(pool, csv, "bad-sync.csv", adminId);

    expect(result.status).toBe("failed");
    expect(result.validRows).toBe(0);
    expect(result.rejectedRows).toBe(1);

    // The good row (FSN-X) must not be ingested either.
    const events = await pool.query(`SELECT fsn FROM batching_events WHERE demand_batch_id = $1`, [
      result.demandBatchId,
    ]);
    expect(events.rows).toHaveLength(0);
    const demand = await pool.query(`SELECT fsn FROM demand WHERE demand_batch_id = $1`, [
      result.demandBatchId,
    ]);
    expect(demand.rows).toHaveLength(0);

    const exceptions = await pool.query(
      `SELECT reason FROM demand_exceptions WHERE demand_batch_id = $1`,
      [result.demandBatchId]
    );
    expect(exceptions.rows[0]?.reason).toBe("fulfilled_exceeds_required");
  });
});
