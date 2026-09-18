import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestDemandFile } from "../src/services/ingestionService.js";

/**
 * Requires TEST_DATABASE_URL with migrations applied. Exercises the full
 * ingestion pipeline against the dummy fixtures in test/fixtures/ — see
 * docs/04-ingestion-contract.md. These fixtures are a stand-in schema
 * (FSN, Darkstore, QtyRequired) until the real external file's headers are
 * confirmed.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe.skipIf(!databaseUrl)("ingestionService (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let uploaderId: string;

  beforeAll(async () => {
    const user = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', $1, 'x', 'admin') RETURNING id`,
      [`admin-${Date.now()}`]
    );
    uploaderId = user.rows[0].id;
  });

  afterAll(async () => {
    const batches = await pool.query(`SELECT id FROM demand_batches WHERE uploaded_by = $1`, [
      uploaderId,
    ]);
    for (const { id } of batches.rows) {
      await pool.query(`DELETE FROM demand_exceptions WHERE demand_batch_id = $1`, [id]);
      await pool.query(`DELETE FROM demand WHERE demand_batch_id = $1`, [id]);
    }
    await pool.query(`DELETE FROM demand_batches WHERE uploaded_by = $1`, [uploaderId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [uploaderId]);
    await pool.end();
  });

  it("ingests a fully valid file as 'completed' with no exceptions", async () => {
    const buffer = readFileSync(path.join(fixturesDir, "sample-demand-valid.csv"));
    const result = await ingestDemandFile(pool, buffer, "sample-demand-valid.csv", uploaderId);
    expect(result.status).toBe("completed");
    expect(result.rejectedRows).toBe(0);
    expect(result.validRows).toBe(15);
  });

  it("ingests a mostly-valid file as 'completed_with_errors', logging bad rows instead of dropping them", async () => {
    const buffer = readFileSync(path.join(fixturesDir, "sample-demand-few-errors.csv"));
    const result = await ingestDemandFile(pool, buffer, "sample-demand-few-errors.csv", uploaderId);
    expect(result.status).toBe("completed_with_errors");
    expect(result.rejectedRows).toBe(2);

    const exceptions = await pool.query(
      `SELECT reason FROM demand_exceptions WHERE demand_batch_id = $1 ORDER BY row_number`,
      [result.demandBatchId]
    );
    expect(exceptions.rows.map((r) => r.reason)).toEqual(["missing_fsn", "qty_not_numeric"]);
  });

  it("fails the whole file (nothing ingested) when >50% of rows are invalid", async () => {
    const buffer = readFileSync(path.join(fixturesDir, "sample-demand-with-errors.csv"));
    const result = await ingestDemandFile(pool, buffer, "sample-demand-with-errors.csv", uploaderId);
    expect(result.status).toBe("failed");
    expect(result.fileLevelError).toBeDefined();
    expect(result.validRows).toBe(0);

    const demandRows = await pool.query(`SELECT COUNT(*) FROM demand WHERE demand_batch_id = $1`, [
      result.demandBatchId,
    ]);
    expect(Number(demandRows.rows[0].count)).toBe(0);
  });
});
