import { describe, expect, it, afterAll } from "vitest";
import { Pool } from "pg";
import { createUser, listUsers, updateUser } from "../src/services/userService.js";
import { ConflictError, NotFoundError } from "../src/lib/errors.js";
import bcrypt from "bcrypt";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("userService (integration)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const createdIds: string[] = [];
  const username = `test-user-${Date.now()}`;

  afterAll(async () => {
    if (createdIds.length > 0) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdIds]);
    }
    await pool.end();
  });

  it("creates a user with a bcrypt-hashed password, never the plaintext", async () => {
    const user = await createUser(pool, {
      name: "Test User",
      username,
      password: "correct-password-123",
      role: "labour",
    });
    createdIds.push(user.id);

    expect(user.username).toBe(username);
    expect(user.active).toBe(true);
    expect((user as unknown as { password_hash?: string }).password_hash).toBeUndefined();

    const raw = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    expect(raw.rows[0].password_hash).not.toBe("correct-password-123");
    expect(await bcrypt.compare("correct-password-123", raw.rows[0].password_hash)).toBe(true);
  });

  it("rejects a duplicate username with ConflictError, not a raw DB error", async () => {
    await expect(
      createUser(pool, { name: "Dup", username, password: "another-password", role: "labour" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists users including the one just created", async () => {
    const users = await listUsers(pool);
    expect(users.some((u) => u.username === username)).toBe(true);
  });

  it("deactivates a user via updateUser", async () => {
    const user = await createUser(pool, {
      name: "To Deactivate",
      username: `${username}-deactivate`,
      password: "some-password-1",
      role: "labour",
    });
    createdIds.push(user.id);

    const updated = await updateUser(pool, user.id, { active: false });
    expect(updated.active).toBe(false);
  });

  it("throws NotFoundError when updating a nonexistent user", async () => {
    await expect(
      updateUser(pool, "00000000-0000-0000-0000-000000000000", { active: false })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
