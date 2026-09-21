import { describe, expect, it, afterEach } from "vitest";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import { ingestUserBulkFile } from "../src/services/userBulkService.js";

/**
 * Requires TEST_DATABASE_URL with migrations applied. Exercises bulk user
 * creation against a real database — the part a pure-validation unit test
 * can't cover: the existing-username DB lookup, and that passwords are
 * actually bcrypt-hashed before storage, never the generated plaintext.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("ingestUserBulkFile (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const createdUsernames: string[] = [];

  afterEach(async () => {
    if (createdUsernames.length > 0) {
      await pool.query(`DELETE FROM users WHERE username = ANY($1::text[])`, [createdUsernames]);
      createdUsernames.length = 0;
    }
  });

  it("creates users with generated, bcrypt-hashed passwords — never the plaintext stored", async () => {
    const suffix = Date.now();
    const csv = Buffer.from(
      "Name,Username,Role\n" +
        `Ramesh Kumar,ramesh-${suffix},labour\n` +
        `Sita Devi,sita-${suffix},supervisor\n`
    );
    const result = await ingestUserBulkFile(pool, csv);
    createdUsernames.push(`ramesh-${suffix}`, `sita-${suffix}`);

    expect(result.validRows).toBe(2);
    expect(result.rejectedRows).toBe(0);
    expect(result.created).toHaveLength(2);

    for (const created of result.created) {
      expect(created.password).toHaveLength(12);
      const row = await pool.query<{ password_hash: string }>(
        `SELECT password_hash FROM users WHERE username = $1`,
        [created.username]
      );
      expect(row.rows[0]?.password_hash).not.toBe(created.password);
      const matches = await bcrypt.compare(created.password, row.rows[0]!.password_hash);
      expect(matches).toBe(true);
    }
  });

  it("rejects a row whose username already exists in the database", async () => {
    const suffix = Date.now();
    const existingUsername = `existing-${suffix}`;
    await pool.query(
      `INSERT INTO users (name, username, password_hash, role) VALUES ('Existing', $1, 'x', 'labour')`,
      [existingUsername]
    );
    createdUsernames.push(existingUsername);

    const csv = Buffer.from(`Name,Username,Role\nNew Name,${existingUsername},labour\n`);
    const result = await ingestUserBulkFile(pool, csv);

    expect(result.validRows).toBe(0);
    expect(result.rejectedRows).toBe(1);
    expect(result.rejected[0]?.reason).toBe("username_taken");
    expect(result.created).toHaveLength(0);
  });

  it("creates no users at all when any row is invalid (all-or-nothing)", async () => {
    const suffix = Date.now();
    const csv = Buffer.from(
      "Name,Username,Role\n" +
        `Good Row,good-${suffix},labour\n` +
        `Bad Role,bad-${suffix},manager\n`
    );
    const result = await ingestUserBulkFile(pool, csv);
    createdUsernames.push(`good-${suffix}`);

    expect(result.created).toHaveLength(0);
    expect(result.validRows).toBe(0);
    expect(result.rejectedRows).toBe(1);
    expect(result.fileLevelError).toContain("no users were created");
    expect(result.rejected[0]?.reason).toBe("invalid_role");

    const exists = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [`good-${suffix}`]);
    expect(exists.rowCount).toBe(0);
  });
});
