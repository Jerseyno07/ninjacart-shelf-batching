import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { submitBatch } from "../src/services/ledgerService.js";

/**
 * Requires a real Postgres reachable via TEST_DATABASE_URL with migrations
 * applied. Exercises the atomic check-then-insert and idempotency-key
 * behavior batching_events depends on (docs/03-data-model.md).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("ledgerService.submitBatch (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let labourId: string;
  let demandBatchId: string;
  const fsn = `TEST-FSN-${Date.now()}`;
  const darkstoreId = `TEST-DS-${Date.now()}`;

  beforeAll(async () => {
    const user = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('L', $1, 'x', 'labour') RETURNING id`,
      [`labour-${Date.now()}`]
    );
    labourId = user.rows[0].id;

    const batch = await pool.query(
      `INSERT INTO demand_batches (source_filename, uploaded_by, status) VALUES ('t.csv', $1, 'completed') RETURNING id`,
      [labourId]
    );
    demandBatchId = batch.rows[0].id;

    await pool.query(
      `INSERT INTO demand (demand_batch_id, fsn, darkstore_id, qty_required) VALUES ($1, $2, $3, 10)`,
      [demandBatchId, fsn, darkstoreId]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM batching_events WHERE fsn = $1`, [fsn]);
    await pool.query(`DELETE FROM demand WHERE fsn = $1`, [fsn]);
    await pool.query(`DELETE FROM demand_batches WHERE id = $1`, [demandBatchId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [labourId]);
    await pool.end();
  });

  it("accepts a submission within remaining demand", async () => {
    const results = await submitBatch(pool, demandBatchId, fsn, labourId, [
      { darkstoreId, qtyBatched: 4, clientRequestId: randomUUID() },
    ]);
    expect(results[0]?.status).toBe("accepted");
  });

  it("rejects a submission that would exceed remaining demand", async () => {
    const results = await submitBatch(pool, demandBatchId, fsn, labourId, [
      { darkstoreId, qtyBatched: 100, clientRequestId: randomUUID() },
    ]);
    expect(results[0]?.status).toBe("rejected");
  });

  it("treats a retried client_request_id as a safe no-op, not a double insert", async () => {
    const clientRequestId = randomUUID();
    const first = await submitBatch(pool, demandBatchId, fsn, labourId, [
      { darkstoreId, qtyBatched: 2, clientRequestId },
    ]);
    const retry = await submitBatch(pool, demandBatchId, fsn, labourId, [
      { darkstoreId, qtyBatched: 2, clientRequestId },
    ]);
    expect(first[0]?.status).toBe("accepted");
    expect(retry[0]?.status).toBe("duplicate");

    const count = await pool.query(
      `SELECT COUNT(*) FROM batching_events WHERE client_request_id = $1`,
      [clientRequestId]
    );
    expect(Number(count.rows[0].count)).toBe(1);
  });
});
