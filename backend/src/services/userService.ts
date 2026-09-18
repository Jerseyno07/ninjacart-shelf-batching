import type { Pool } from "pg";
import { hashPassword } from "./authService.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";

export interface UserRow {
  id: string;
  name: string;
  username: string;
  role: "labour" | "supervisor" | "admin";
  active: boolean;
  created_at: string;
}

const USER_COLUMNS = "id, name, username, role, active, created_at";

export interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  role: "labour" | "supervisor" | "admin";
}

export async function createUser(pool: Pool, input: CreateUserInput): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  try {
    const result = await pool.query<UserRow>(
      `INSERT INTO users (name, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [input.name, input.username, passwordHash, input.role]
    );
    return result.rows[0]!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`Username '${input.username}' is already taken`);
    }
    throw err;
  }
}

export async function listUsers(pool: Pool): Promise<UserRow[]> {
  const result = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`
  );
  return result.rows;
}

export interface UpdateUserInput {
  active?: boolean;
  password?: string;
}

export async function updateUser(
  pool: Pool,
  id: string,
  input: UpdateUserInput
): Promise<UserRow> {
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;

  const result = await pool.query<UserRow>(
    `UPDATE users
     SET active = COALESCE($2, active),
         password_hash = COALESCE($3, password_hash)
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [id, input.active ?? null, passwordHash ?? null]
  );

  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError(`No user with id ${id}`);
  }
  return row;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
