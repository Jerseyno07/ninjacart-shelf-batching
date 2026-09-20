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
  if (fileLevelError) {
    return {
      totalRows: records.length,
      validRows: 0,
      rejectedRows: rejectedRows.length,
      fileLevelError,
      created: [],
      rejected: rejectedRows,
    };
  }

  const created: CreatedUser[] = [];
  const rejected: RejectedUserRowResult[] = [...rejectedRows];

  // One insert per row, not a single unnest — each row needs its own
  // freshly-generated password and bcrypt hash before the insert, unlike
  // the demand-ingestion bulk inserts which write uniform rows.
  for (const [index, row] of validRows.entries()) {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    try {
      await pool.query(
        `INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4)`,
        [row.name, row.username, passwordHash, row.role]
      );
      created.push({ name: row.name, username: row.username, role: row.role, password });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Only reachable if the same username was created concurrently by
        // another request between the existingUsernames snapshot above and
        // this insert — validateUserRows already rejects in-file dupes and
        // usernames that existed at snapshot time.
        rejected.push({
          rowNumber: index + 1,
          rawRow: { Name: row.name, Username: row.username, Role: row.role },
          reason: "username_taken",
        });
      } else {
        throw err;
      }
    }
  }

  return {
    totalRows: records.length,
    validRows: created.length,
    rejectedRows: records.length - created.length,
    created,
    rejected,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
