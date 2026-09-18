import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { acquireLock, releaseLock } from "../src/services/lockService.js";
import { LockConflictError } from "../src/lib/errors.js";

/**
 * Requires a real Postgres reachable via TEST_DATABASE_URL, with migrations
 * applied (npm run migrate:up). Skipped otherwise — see backend/README.md.
 * This exercises the exact concurrency property ADR-001 depends on: the
 * lock acquire is one atomic statement, not read-then-write.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("lockService (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let labourA: string;
  let labourB: string;

  beforeAll(async () => {
    const a = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('A', $1, 'x', 'labour') RETURNING id`,
      [`labour-a-${Date.now()}`]
    );
    const b = await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('B', $1, 'x', 'labour') RETURNING id`,
      [`labour-b-${Date.now()}`]
    );
    labourA = a.rows[0].id;
    labourB = b.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM fsn_lock_events WHERE fsn LIKE 'TEST-FSN-%'`);
    await pool.query(`DELETE FROM fsn_locks WHERE fsn LIKE 'TEST-FSN-%'`);
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [labourA, labourB]);
    await pool.end();
  });

  // Each test uses its own fsn — sharing one across tests previously meant a
  // lock left held at the end of one test made the *next* test's first call
  // throw unexpectedly, instead of the second call as intended.

  it("lets a second labourer acquire once the first explicitly releases", async () => {
    const fsn = `TEST-FSN-${Date.now()}-a`;
    await acquireLock(pool, fsn, labourA);
    await releaseLock(pool, fsn, labourA);
    const lock = await acquireLock(pool, fsn, labourB);
    expect(lock.labour_id).toBe(labourB);
    await releaseLock(pool, fsn, labourB);
  });

  it("blocks a second labourer while the first holds an unexpired lock", async () => {
    const fsn = `TEST-FSN-${Date.now()}-b`;
    await acquireLock(pool, fsn, labourA);
    await expect(acquireLock(pool, fsn, labourB)).rejects.toBeInstanceOf(LockConflictError);
    await releaseLock(pool, fsn, labourA);
  });

  // Regression: a retried acquire from the SAME labourer (offline-queue
  // retry, or a re-invoked effect) must succeed, not 409 against itself.
  // Found live: a React dev-mode double-effect invocation did exactly this
  // and got incorrectly rejected before the WHERE clause fix.
  it("lets a labourer re-acquire (extend) a lock they already hold, without conflict", async () => {
    const fsn = `TEST-FSN-${Date.now()}-c`;
    const first = await acquireLock(pool, fsn, labourA);
    const second = await acquireLock(pool, fsn, labourA);
    expect(second.labour_id).toBe(labourA);
    expect(new Date(second.expires_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.expires_at).getTime()
    );
    await releaseLock(pool, fsn, labourA);
  });
});
