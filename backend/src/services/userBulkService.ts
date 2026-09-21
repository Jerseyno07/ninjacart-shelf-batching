import { parse } from "csv-parse/sync";
import { randomInt } from "node:crypto";
import type { Pool } from "pg";
import { hashPassword } from "./authService.js";
import { validateUserHeaders, validateUserRows, type RawUserRow } from "./userBulkValidation.js";
import { ValidationError } from "../lib/errors.js";

export interface CreatedUser {
  name: string;
  username: string;
  role: string;
  password: string;
}

export interface RejectedUserRowResult {
  rowNumber: number;
  rawRow: RawUserRow;
  reason: string;
}

export interface BulkUserResult {
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  fileLevelError?: string;
  created: CreatedUser[];
  rejected: RejectedUserRowResult[];
}

// Unambiguous charset — no 0/O or 1/l/I, since these get read off a screen
// and typed on a shared warehouse device.
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generatePassword(length = 12): string {
  let password = "";
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)];
  }
  return password;
}

/**
 * Bulk user creation from a CSV (Name, Username, Role). Passwords are never
 * read from the file — each valid row gets a fresh server-generated
 * password, returned once in the response so the admin can hand it out.
 * Nothing is persisted in plaintext; only the bcrypt hash is stored (see
 * docs/06-incident-decisions-log.md for why auto-generation was chosen over
 * a Password column in the file).
 */
export async function ingestUserBulkFile(pool: Pool, fileBuffer: Buffer): Promise<BulkUserResult> {
  let records: RawUserRow[];
  try {
    records = parse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new ValidationError(`Could not parse file as CSV: ${(err as Error).message}`);
  }

  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const headerError = validateUserHeaders(headers);
  if (headerError) {
    return {
      totalRows: records.length,
      validRows: 0,
      rejectedRows: 0,
      fileLevelError: headerError,
      created: [],
      rejected: [],
    };
  }

  const existingResult = await pool.query<{ username: string }>(`SELECT username FROM users`);
  const existingUsernames = new Set(existingResult.rows.map((r) => r.username));

  const { validRows, rejectedRows, fileLevelError } = validateUserRows(records, existingUsernames);
  // Strictly all-or-nothing: one flagged row rejects the whole file and no
  // user is created. The flagged rows are returned so the admin can fix them.
  const failure =
    fileLevelError ??
    (rejectedRows.length > 0
      ? `${rejectedRows.length} row(s) failed validation — no users were created. Fix every flagged row and re-upload the whole file.`
      : undefined);
  if (failure) {
    return {
      totalRows: records.length,
      validRows: 0,
      rejectedRows: rejectedRows.length,
      fileLevelError: failure,
      created: [],
      rejected: rejectedRows,
    };
  }

  // Hash first (slow, no DB), then insert everything in one transaction so a
  // conflict part-way through cannot leave a partial set of users behind.
  const prepared = [];
  for (const row of validRows) {
    const password = generatePassword();
    prepared.push({ row, password, passwordHash: await hashPassword(password) });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { row, passwordHash } of prepared) {
      await client.query(
        `INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4)`,
        [row.name, row.username, passwordHash, row.role]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(err)) {
      // Another request created one of these usernames after the snapshot above.
      return {
        totalRows: records.length,
        validRows: 0,
        rejectedRows: 0,
        fileLevelError: "A username in this file was created by someone else while uploading — no users were created. Re-upload the file.",
        created: [],
        rejected: [],
      };
    }
    throw err;
  } finally {
    client.release();
  }

  return {
    totalRows: records.length,
    validRows: prepared.length,
    rejectedRows: 0,
    created: prepared.map(({ row, password }) => ({
      name: row.name,
      username: row.username,
      role: row.role,
      password,
    })),
    rejected: [],
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
