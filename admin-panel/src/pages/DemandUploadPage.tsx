import { Fragment, useCallback, useRef, useState } from "react";
import { usePolling } from "../hooks/usePolling.js";
import {
  uploadDemandFile,
  fetchDemandBatches,
  fetchDemandExceptions,
} from "../api/endpoints.js";
import type { DemandException, IngestResult } from "../api/types.js";
import { ApiError, NetworkError } from "../api/client.js";

function statusBadgeClass(status: string): string {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "completed_with_errors") return "bg-amber-100 text-amber-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-800";
}

function downloadExceptionsCsv(batchId: string, exceptions: DemandException[]): void {
  const headerKeys = Array.from(new Set(exceptions.flatMap((e) => Object.keys(e.raw_row))));
  const header = ["row_number", "reason", ...headerKeys];
  const lines = [header.join(",")];
  for (const exc of exceptions) {
    const row = [
      String(exc.row_number),
      exc.reason,
      ...headerKeys.map((k) => JSON.stringify(exc.raw_row[k] ?? "")),
    ];
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `exceptions-${batchId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DemandUploadPage() {
  const { data, loading, refetch } = usePolling(fetchDemandBatches, 15000);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<IngestResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<DemandException[]>([]);
  const [loadingExceptions, setLoadingExceptions] = useState(false);

  const handleUpload = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await uploadDemandFile(file);
      setUploadResult(result);
      refetch();
    } catch (err) {
      if (err instanceof NetworkError) setUploadError("No connection — check your network.");
      else if (err instanceof ApiError) setUploadError(err.message);
      else setUploadError("Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [refetch]);

  const toggleExceptions = useCallback(async (batchId: string) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      return;
    }
    setExpandedBatchId(batchId);
    setLoadingExceptions(true);
    try {
      const { exceptions: rows } = await fetchDemandExceptions(batchId);
      setExceptions(rows);
    } finally {
      setLoadingExceptions(false);
    }
  }, [expandedBatchId]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Demand Upload</h2>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <label className="block text-sm font-medium mb-2">Upload a demand CSV</label>
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept=".csv" className="text-sm" />
          <button
            onClick={() => void handleUpload()}
            disabled={uploading}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadError && <p className="text-red-600 text-sm mt-3">{uploadError}</p>}
        {uploadResult && (
          <div className="mt-3 text-sm">
            <span className={`inline-block px-2 py-0.5 rounded ${statusBadgeClass(uploadResult.status)}`}>
              {uploadResult.status}
            </span>
            <span className="ml-2 text-gray-600">
              {uploadResult.validRows} valid, {uploadResult.rejectedRows} rejected of{" "}
              {uploadResult.totalRows} rows
            </span>
            {uploadResult.fileLevelError && (
              <p className="text-red-600 mt-1">{uploadResult.fileLevelError}</p>
            )}
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold mb-2">Ingestion history</h3>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">File</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Rows</th>
              <th className="px-4 py-2">Uploaded</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.batches.map((batch) => (
              <Fragment key={batch.id}>
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2">{batch.source_filename}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeClass(batch.status)}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {batch.valid_rows} valid / {batch.rejected_rows} rejected
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(batch.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {batch.rejected_rows > 0 && (
                      <button
                        className="text-sm underline text-gray-600"
                        onClick={() => void toggleExceptions(batch.id)}
                      >
                        {expandedBatchId === batch.id ? "Hide" : "View"} exceptions
                      </button>
                    )}
                  </td>
                </tr>
                {expandedBatchId === batch.id && (
                  <tr className="border-t border-gray-100 bg-gray-50">
                    <td colSpan={5} className="px-4 py-3">
                      {loadingExceptions ? (
                        <p className="text-gray-500">Loading…</p>
                      ) : (
                        <>
                          <div className="flex justify-between items-center mb-2">
                            <p className="text-sm font-medium">{exceptions.length} rejected rows</p>
                            <button
                              className="text-sm underline text-gray-600"
                              onClick={() => downloadExceptionsCsv(batch.id, exceptions)}
                            >
                              Download CSV
                            </button>
                          </div>
                          <table className="w-full text-xs">
                            <thead className="text-left text-gray-500">
                              <tr>
                                <th className="py-1 pr-4">Row</th>
                                <th className="py-1 pr-4">Reason</th>
                                <th className="py-1 pr-4">Raw data</th>
                              </tr>
                            </thead>
                            <tbody>
                              {exceptions.map((exc) => (
                                <tr key={exc.row_number} className="border-t border-gray-200">
                                  <td className="py-1 pr-4">{exc.row_number}</td>
                                  <td className="py-1 pr-4">{exc.reason}</td>
                                  <td className="py-1 pr-4 font-mono">{JSON.stringify(exc.raw_row)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {loading && <p className="p-4 text-gray-500">Loading…</p>}
        {!loading && data?.batches.length === 0 && (
          <p className="p-4 text-gray-500">No uploads yet.</p>
        )}
      </div>
    </div>
  );
}
