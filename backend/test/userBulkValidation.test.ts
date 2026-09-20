import { describe, expect, it } from "vitest";
import { validateUserHeaders, validateUserRows } from "../src/services/userBulkValidation.js";

describe("validateUserHeaders", () => {
  it("passes when all required headers are present, case-insensitively", () => {
    expect(validateUserHeaders(["name", "USERNAME", "Role"])).toBeUndefined();
  });

  it("reports missing headers", () => {
    const error = validateUserHeaders(["Name", "Role"]);
    expect(error).toContain("Username");
  });
});

describe("validateUserRows", () => {
  it("accepts well-formed rows", () => {
    const result = validateUserRows(
      [{ Name: "Ramesh Kumar", Username: "ramesh.k", Role: "labour" }],
      new Set()
    );
    expect(result.rejectedRows).toHaveLength(0);
    expect(result.validRows).toEqual([{ name: "Ramesh Kumar", username: "ramesh.k", role: "labour" }]);
  });

  it("accepts role case-insensitively", () => {
    const result = validateUserRows(
      [{ Name: "Sita Devi", Username: "sita.d", Role: "SUPERVISOR" }],
      new Set()
    );
    expect(result.validRows[0]?.role).toBe("supervisor");
  });

  it("rejects a row with missing name, without dropping it silently", () => {
    const result = validateUserRows(
      [{ Name: "", Username: "u1", Role: "labour" }],
      new Set()
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.rejectedRows).toEqual([
      { rowNumber: 1, rawRow: { Name: "", Username: "u1", Role: "labour" }, reason: "missing_name" },
    ]);
  });

  it("rejects a row with missing username", () => {
    const result = validateUserRows([{ Name: "N", Username: "", Role: "labour" }], new Set());
    expect(result.rejectedRows[0]?.reason).toBe("missing_username");
  });

  it("rejects an invalid role", () => {
    const result = validateUserRows(
      [{ Name: "N", Username: "u1", Role: "manager" }],
      new Set()
    );
    expect(result.rejectedRows[0]?.reason).toBe("invalid_role");
  });

  it("rejects a duplicate username within the same file", () => {
    const result = validateUserRows(
      [
        { Name: "A", Username: "dupe", Role: "labour" },
        { Name: "B", Username: "dupe", Role: "labour" },
      ],
      new Set()
    );
    expect(result.validRows).toHaveLength(1);
    expect(result.rejectedRows[0]?.reason).toBe("duplicate_row");
  });

  it("rejects a username that already exists in the database", () => {
    const result = validateUserRows(
      [{ Name: "N", Username: "existing1", Role: "labour" }],
      new Set(["existing1"])
    );
    expect(result.rejectedRows[0]?.reason).toBe("username_taken");
  });

  it("rejects the whole file if more than 50% of rows fail validation", () => {
    const result = validateUserRows(
      [
        { Name: "", Username: "u1", Role: "labour" },
        { Name: "", Username: "u2", Role: "labour" },
        { Name: "N3", Username: "u3", Role: "labour" },
      ],
      new Set()
    );
    expect(result.fileLevelError).toBeDefined();
    expect(result.validRows).toHaveLength(0);
  });

  it("reports an empty file as a file-level error", () => {
    const result = validateUserRows([], new Set());
    expect(result.fileLevelError).toBe("File contains no data rows");
  });
});
