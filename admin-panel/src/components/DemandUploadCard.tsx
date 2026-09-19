import { useCallback, useRef, useState } from "react";
import type { IngestResult } from "../api/types.js";
import { ApiError, NetworkError } from "../api/client.js";

function statusBadgeClass(status: string): string {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "completed_with_errors") return "bg-amber-100 text-amber-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-800";
}

interface Props {
  title: string;
  columnsDescription: string;
  sampleFileHref: string;
  uploadFn: (file: File) => Promise<IngestResult>;
  onSuccess: () => void;
}

export function DemandUploadCard({ title, columnsDescription, sampleFileHref, uploadFn, onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const response = await uploadFn(file);
      setResult(response);
      onSuccess();
    } catch (err) {
      if (err instanceof NetworkError) setError("No connection — check your network.");
      else if (err instanceof ApiError) setError(err.message);
      else setError("Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [uploadFn, onSuccess]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium">{title}</label>
        <a href={sampleFileHref} download className="text-sm underline text-gray-600">
          Download sample file
        </a>
      </div>
      <p className="text-xs text-gray-500 mb-2">{columnsDescription}</p>
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
        <div className="mt-3 text-sm">
          <span className={`inline-block px-2 py-0.5 rounded ${statusBadgeClass(result.status)}`}>
            {result.status}
          </span>
          <span className="ml-2 text-gray-600">
            {result.validRows} valid, {result.rejectedRows} rejected of {result.totalRows} rows
          </span>
          {result.fileLevelError && <p className="text-red-600 mt-1">{result.fileLevelError}</p>}
        </div>
      )}
    </div>
  );
}
