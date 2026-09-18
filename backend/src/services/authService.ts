import bcrypt from "bcrypt";
import type { Pool } from "pg";
import { UnauthorizedError } from "../lib/errors.js";

export interface AuthenticatedUser {
  id: string;
  name: string;
  username: string;
  role: "labour" | "supervisor" | "admin";
}

export async function login(pool: Pool, username: string, password: string): Promise<AuthenticatedUser> {
  const result = await pool.query<{
    id: string;
    name: string;
    username: string;
    password_hash: string;
    role: "labour" | "supervisor" | "admin";
    active: boolean;
  }>(`SELECT id, name, username, password_hash, role, active FROM users WHERE username = $1`, [
    username,
  ]);

  const user = result.rows[0];
  if (!user || !user.active) {
    throw new UnauthorizedError("Invalid username or password");
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new UnauthorizedError("Invalid username or password");
  }

  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
