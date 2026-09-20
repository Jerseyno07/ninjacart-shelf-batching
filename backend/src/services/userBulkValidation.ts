/**
 * Pure validation logic for bulk user CSV uploads. Mirrors
 * ingestionValidation.ts's shape (headers → rows → valid/rejected) so the
 * admin panel's error reporting is consistent across both upload types.
 */

export interface RawUserRow {
  [column: string]: string | undefined;
}

const VALID_ROLES = ["labour", "supervisor", "admin"] as const;
export type BulkUserRole = (typeof VALID_ROLES)[number];

export interface ValidUserRow {
  name: string;
  username: string;
  role: BulkUserRole;
}

export interface RejectedUserRow {
  rowNumber: number;
  rawRow: RawUserRow;
  reason: string;
}

export interface UserValidationResult {
  validRows: ValidUserRow[];
  rejectedRows: RejectedUserRow[];
  fileLevelError?: string;
}

const REQUIRED_HEADERS = ["Name", "Username", "Role"];
const FILE_LEVEL_REJECT_THRESHOLD = 0.5;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function findColumn(row: RawUserRow, name: string): string | undefined {
  const target = normalizeHeader(name);
  for (const key of Object.keys(row)) {
    if (normalizeHeader(key) === target) {
      return row[key];
    }
  }
  return undefined;
}

export function validateUserHeaders(headers: string[]): string | undefined {
  const normalized = new Set(headers.map(normalizeHeader));
  const missing = REQUIRED_HEADERS.filter((h) => !normalized.has(normalizeHeader(h)));
  if (missing.length > 0) {
    return `Missing required header(s): ${missing.join(", ")}`;
  }
  return undefined;
}

/**
 * No password column — passwords are always server-generated per row (see
 * docs/06-incident-decisions-log.md), never taken from the uploaded file.
 */
export function validateUserRows(
  rows: RawUserRow[],
  existingUsernames: Set<string>
): UserValidationResult {
  if (rows.length === 0) {
    return { validRows: [], rejectedRows: [], fileLevelError: "File contains no data rows" };
  }

  const validRows: ValidUserRow[] = [];
  const rejectedRows: RejectedUserRow[] = [];
  const seenUsernames = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const name = findColumn(row, "Name")?.trim();
    const username = findColumn(row, "Username")?.trim();
    const roleRaw = findColumn(row, "Role")?.trim().toLowerCase();

    if (!name) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "missing_name" });
      return;
    }
    if (!username) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "missing_username" });
      return;
    }
    if (!roleRaw || !VALID_ROLES.includes(roleRaw as BulkUserRole)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "invalid_role" });
      return;
    }
    if (seenUsernames.has(username)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "duplicate_row" });
      return;
    }
    if (existingUsernames.has(username)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "username_taken" });
      return;
    }
    seenUsernames.add(username);

    validRows.push({ name, username, role: roleRaw as BulkUserRole });
  });

  const rejectRate = rejectedRows.length / rows.length;
  if (rejectRate > FILE_LEVEL_REJECT_THRESHOLD) {
    return {
      validRows: [],
      rejectedRows,
      fileLevelError: `${Math.round(rejectRate * 100)}% of rows failed validation (threshold ${
        FILE_LEVEL_REJECT_THRESHOLD * 100
      }%) — likely an upstream format change, not a few bad rows`,
    };
  }

  return { validRows, rejectedRows };
}
