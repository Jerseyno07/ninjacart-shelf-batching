/**
 * Pure validation logic for demand-file ingestion (docs/04-ingestion-contract.md).
 * Kept free of DB/IO so it's directly unit-testable — the untrusted external
 * file is validated the same way regardless of how it arrived.
 */

export interface RawDemandRow {
  [column: string]: string | undefined;
}

export interface ValidRow {
  fsn: string;
  darkstoreId: string;
  qtyRequired: number;
}

export interface RejectedRow {
  rowNumber: number;
  rawRow: RawDemandRow;
  reason: string;
}

export interface ValidationResult {
  validRows: ValidRow[];
  rejectedRows: RejectedRow[];
  fileLevelError?: string;
}

const REQUIRED_HEADERS = ["FSN", "Darkstore", "QtyRequired"];
const FILE_LEVEL_REJECT_THRESHOLD = 0.5;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

export function validateHeaders(headers: string[]): string | undefined {
  const normalized = new Set(headers.map(normalizeHeader));
  const missing = REQUIRED_HEADERS.filter((h) => !normalized.has(normalizeHeader(h)));
  if (missing.length > 0) {
    return `Missing required header(s): ${missing.join(", ")}`;
  }
  return undefined;
}

function findColumn(row: RawDemandRow, name: string): string | undefined {
  const target = normalizeHeader(name);
  for (const key of Object.keys(row)) {
    if (normalizeHeader(key) === target) {
      return row[key];
    }
  }
  return undefined;
}

export function validateRows(
  rows: RawDemandRow[],
  knownDarkstoreIds: Set<string> | null
): ValidationResult {
  if (rows.length === 0) {
    return { validRows: [], rejectedRows: [], fileLevelError: "File contains no data rows" };
  }

  const validRows: ValidRow[] = [];
  const rejectedRows: RejectedRow[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const fsn = findColumn(row, "FSN")?.trim();
    const darkstoreId = findColumn(row, "Darkstore")?.trim();
    const qtyRaw = findColumn(row, "QtyRequired")?.trim();

    if (!fsn) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "missing_fsn" });
      return;
    }
    if (!darkstoreId) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "missing_darkstore" });
      return;
    }
    if (knownDarkstoreIds && !knownDarkstoreIds.has(darkstoreId)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "unknown_darkstore" });
      return;
    }
    if (!qtyRaw || !/^\d+$/.test(qtyRaw)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "qty_not_numeric" });
      return;
    }
    const qtyRequired = Number.parseInt(qtyRaw, 10);
    if (qtyRequired <= 0) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "qty_not_positive" });
      return;
    }

    const dedupeKey = `${fsn}::${darkstoreId}`;
    if (seenKeys.has(dedupeKey)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "duplicate_row" });
      return;
    }
    seenKeys.add(dedupeKey);

    validRows.push({ fsn, darkstoreId, qtyRequired });
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

/**
 * Sync import (docs/04-ingestion-contract.md "Sync existing progress"):
 * same base columns as a normal demand upload, plus QtyFulfilled — for
 * migrating in demand that's already been partially or fully fulfilled in
 * a parent system before this one went live. A row where QtyFulfilled
 * exceeds QtyRequired is rejected rather than clamped or accepted with
 * negative remaining — that mismatch means our own demand figure is
 * wrong and needs a human to look at it, not a silent adjustment.
 */
export interface ValidSyncRow extends ValidRow {
  qtyFulfilled: number;
}

const SYNC_REQUIRED_HEADERS = ["FSN", "Darkstore", "QtyRequired", "QtyFulfilled"];

export function validateSyncHeaders(headers: string[]): string | undefined {
  const normalized = new Set(headers.map(normalizeHeader));
  const missing = SYNC_REQUIRED_HEADERS.filter((h) => !normalized.has(normalizeHeader(h)));
  if (missing.length > 0) {
    return `Missing required header(s): ${missing.join(", ")}`;
  }
  return undefined;
}

export function validateSyncRows(
  rows: RawDemandRow[],
  knownDarkstoreIds: Set<string> | null
): { validRows: ValidSyncRow[]; rejectedRows: RejectedRow[]; fileLevelError?: string } {
  if (rows.length === 0) {
    return { validRows: [], rejectedRows: [], fileLevelError: "File contains no data rows" };
  }

  const validRows: ValidSyncRow[] = [];
  const rejectedRows: RejectedRow[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const fsn = findColumn(row, "FSN")?.trim();
    const darkstoreId = findColumn(row, "Darkstore")?.trim();
    const qtyRaw = findColumn(row, "QtyRequired")?.trim();
    const fulfilledRaw = findColumn(row, "QtyFulfilled")?.trim();

    if (!fsn) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "missing_fsn" });
      return;
    }
    if (!darkstoreId) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "missing_darkstore" });
      return;
    }
    if (knownDarkstoreIds && !knownDarkstoreIds.has(darkstoreId)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "unknown_darkstore" });
      return;
    }
    if (!qtyRaw || !/^\d+$/.test(qtyRaw)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "qty_not_numeric" });
      return;
    }
    const qtyRequired = Number.parseInt(qtyRaw, 10);
    if (qtyRequired <= 0) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "qty_not_positive" });
      return;
    }
    if (!fulfilledRaw || !/^\d+$/.test(fulfilledRaw)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "qty_fulfilled_not_numeric" });
      return;
    }
    const qtyFulfilled = Number.parseInt(fulfilledRaw, 10);
    if (qtyFulfilled > qtyRequired) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "fulfilled_exceeds_required" });
      return;
    }

    const dedupeKey = `${fsn}::${darkstoreId}`;
    if (seenKeys.has(dedupeKey)) {
      rejectedRows.push({ rowNumber, rawRow: row, reason: "duplicate_row" });
      return;
    }
    seenKeys.add(dedupeKey);

    validRows.push({ fsn, darkstoreId, qtyRequired, qtyFulfilled });
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
