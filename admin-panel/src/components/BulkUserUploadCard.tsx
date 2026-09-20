import { useCallback, useRef, useState } from "react";
import type { BulkUserResult } from "../api/types.js";
import { uploadUsersBulkFile } from "../api/endpoints.js";
import { ApiError, NetworkError } from "../api/client.js";

function downloadCredentialsCsv(created: BulkUserResult["created"]) {
  const header = "Name,Username,Role,Password\n";
  const rows = created
    .map((u) => `${u.name},${u.username},${u.role},${u.password}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `new-user-credentials-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

interface Props {
  onSuccess: () => void;
}

export function BulkUserUploadCard({ onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BulkUserResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const response = await uploadUsersBulkFile(file);
      setResult(response);
      if (response.created.length > 0) onSuccess();
    } catch (err) {
      if (err instanceof NetworkError) setError("No connection — check your network.");
      else if (err instanceof ApiError) setError(err.message);
      else setError("Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [onSuccess]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium">Bulk create users</label>
        <a href="/sample-users-bulk.csv" download className="text-sm underline text-gray-600">
          Download sample file
        </a>
      </div>
      <p className="text-xs text-gray-500 mb-2">
        Columns: Name, Username, Role (labour, supervisor, or admin). Passwords are generated
        automatically — shown once below and downloadable as a CSV. They are never stored in
        plain text.
      </p>
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
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      {result && (
        <div className="mt-4">
          <p className="text-sm text-gray-600">
            {result.validRows} created, {result.rejectedRows} rejected of {result.totalRows} rows
          </p>
          {result.fileLevelError && <p className="text-red-600 text-sm mt-1">{result.fileLevelError}</p>}

          {result.created.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-gray-700">
                  New credentials — copy or download now, this is shown only once
                </p>
                <button
                  onClick={() => downloadCredentialsCsv(result.created)}
                  className="text-xs underline text-gray-600"
                >
                  Download as CSV
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th className="px-3 py-1.5">Name</th>
                      <th className="px-3 py-1.5">Username</th>
                      <th className="px-3 py-1.5">Role</th>
                      <th className="px-3 py-1.5">Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.created.map((u) => (
                      <tr key={u.username} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">{u.name}</td>
                        <td className="px-3 py-1.5">{u.username}</td>
                        <td className="px-3 py-1.5 capitalize">{u.role}</td>
                        <td className="px-3 py-1.5 font-mono">{u.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.rejected.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-700 mb-1">Rejected rows</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr>
                      <th className="px-3 py-1.5">Row</th>
                      <th className="px-3 py-1.5">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rejected.map((r) => (
                      <tr key={r.rowNumber} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">{r.rowNumber}</td>
                        <td className="px-3 py-1.5">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
