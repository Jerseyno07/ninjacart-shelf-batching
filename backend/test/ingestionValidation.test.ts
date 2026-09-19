import { describe, expect, it } from "vitest";
import {
  validateHeaders,
  validateRows,
  validateSyncHeaders,
  validateSyncRows,
} from "../src/services/ingestionValidation.js";

describe("validateHeaders", () => {
  it("passes when all required headers are present, case-insensitively", () => {
    expect(validateHeaders(["fsn", "DARKSTORE", "QtyRequired"])).toBeUndefined();
  });

  it("reports missing headers", () => {
    const error = validateHeaders(["FSN", "QtyRequired"]);
    expect(error).toContain("Darkstore");
  });
});

describe("validateRows", () => {
  it("accepts well-formed rows", () => {
    const result = validateRows(
      [{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10" }],
      null
    );
    expect(result.rejectedRows).toHaveLength(0);
    expect(result.validRows).toEqual([{ fsn: "SKU1", darkstoreId: "DS1", qtyRequired: 10 }]);
  });

  it("rejects a row with missing FSN, without dropping it silently", () => {
    const result = validateRows([{ FSN: "", Darkstore: "DS1", QtyRequired: "10" }], null);
    expect(result.validRows).toHaveLength(0);
    expect(result.rejectedRows).toEqual([
      { rowNumber: 1, rawRow: { FSN: "", Darkstore: "DS1", QtyRequired: "10" }, reason: "missing_fsn" },
    ]);
  });

  it("rejects non-numeric quantity", () => {
    const result = validateRows([{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "abc" }], null);
    expect(result.rejectedRows[0]?.reason).toBe("qty_not_numeric");
  });

  it("rejects zero and negative quantity", () => {
    const result = validateRows(
      [
        { FSN: "SKU1", Darkstore: "DS1", QtyRequired: "0" },
        { FSN: "SKU2", Darkstore: "DS1", QtyRequired: "-5" },
      ],
      null
    );
    expect(result.rejectedRows).toHaveLength(2);
    expect(result.rejectedRows.map((r) => r.reason)).toEqual(["qty_not_positive", "qty_not_numeric"]);
  });

  it("rejects duplicate FSN+darkstore rows within the same file", () => {
    const result = validateRows(
      [
        { FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10" },
        { FSN: "SKU1", Darkstore: "DS1", QtyRequired: "5" },
      ],
      null
    );
    expect(result.validRows).toHaveLength(1);
    expect(result.rejectedRows[0]?.reason).toBe("duplicate_row");
  });

  it("rejects rows referencing an unknown darkstore when a known set is provided", () => {
    const result = validateRows(
      [{ FSN: "SKU1", Darkstore: "GHOST", QtyRequired: "10" }],
      new Set(["DS1", "DS2"])
    );
    expect(result.rejectedRows[0]?.reason).toBe("unknown_darkstore");
  });

  it("flags a file-level error when more than 50% of rows are invalid, and discards partial results", () => {
    const rows = [
      { FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10" },
      { FSN: "", Darkstore: "DS1", QtyRequired: "10" },
      { FSN: "SKU2", Darkstore: "", QtyRequired: "10" },
      { FSN: "SKU3", Darkstore: "DS1", QtyRequired: "bad" },
    ];
    const result = validateRows(rows, null);
    expect(result.fileLevelError).toBeDefined();
    expect(result.validRows).toHaveLength(0);
  });

  it("flags an empty file distinctly", () => {
    const result = validateRows([], null);
    expect(result.fileLevelError).toBe("File contains no data rows");
  });
});

describe("validateSyncHeaders", () => {
  it("requires QtyFulfilled in addition to the base columns", () => {
    const error = validateSyncHeaders(["FSN", "Darkstore", "QtyRequired"]);
    expect(error).toContain("QtyFulfilled");
  });

  it("passes when all four columns are present, case-insensitively", () => {
    expect(validateSyncHeaders(["fsn", "darkstore", "qtyrequired", "QTYFULFILLED"])).toBeUndefined();
  });
});

describe("validateSyncRows", () => {
  it("accepts a row with QtyFulfilled less than QtyRequired", () => {
    const result = validateSyncRows(
      [{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10", QtyFulfilled: "4" }],
      null
    );
    expect(result.rejectedRows).toHaveLength(0);
    expect(result.validRows).toEqual([
      { fsn: "SKU1", darkstoreId: "DS1", qtyRequired: 10, qtyFulfilled: 4 },
    ]);
  });

  it("accepts QtyFulfilled of exactly 0 (nothing synced yet for this row)", () => {
    const result = validateSyncRows(
      [{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10", QtyFulfilled: "0" }],
      null
    );
    expect(result.validRows[0]?.qtyFulfilled).toBe(0);
  });

  it("accepts QtyFulfilled equal to QtyRequired (fully synced)", () => {
    const result = validateSyncRows(
      [{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10", QtyFulfilled: "10" }],
      null
    );
    expect(result.rejectedRows).toHaveLength(0);
  });

  it("rejects QtyFulfilled greater than QtyRequired rather than clamping or accepting it", () => {
    const result = validateSyncRows(
      [{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10", QtyFulfilled: "11" }],
      null
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.rejectedRows[0]?.reason).toBe("fulfilled_exceeds_required");
  });

  it("rejects a non-numeric QtyFulfilled", () => {
    const result = validateSyncRows(
      [{ FSN: "SKU1", Darkstore: "DS1", QtyRequired: "10", QtyFulfilled: "abc" }],
      null
    );
    expect(result.rejectedRows[0]?.reason).toBe("qty_fulfilled_not_numeric");
  });
});
