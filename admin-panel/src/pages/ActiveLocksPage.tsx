import { useState } from "react";
import { usePolling } from "../hooks/usePolling.js";
import { fetchActiveLocks, forceUnlock } from "../api/endpoints.js";
import { ApiError, NetworkError } from "../api/client.js";

export function ActiveLocksPage() {
  const { data, error, loading, refetch } = usePolling(fetchActiveLocks, 5000);
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleForceUnlock() {
    if (!unlockTarget || !reason.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await forceUnlock(unlockTarget, reason.trim());
      setUnlockTarget(null);
      setReason("");
      refetch();
    } catch (err) {
      if (err instanceof NetworkError) setActionError("No connection — check your network.");
      else if (err instanceof ApiError) setActionError(err.message);
      else setActionError("Force-unlock failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">Could not load active locks: {error.message}</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Active Locks</h2>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">FSN</th>
              <th className="px-4 py-2">Held by</th>
              <th className="px-4 py-2">Acquired</th>
              <th className="px-4 py-2">Expires</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.locks.map((lock) => (
              <tr key={lock.fsn} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{lock.fsn}</td>
                <td className="px-4 py-2">{lock.labour_name}</td>
                <td className="px-4 py-2 text-gray-500">
                  {new Date(lock.acquired_at).toLocaleTimeString()}
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {new Date(lock.expires_at).toLocaleTimeString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    className="text-sm underline text-red-600"
                    onClick={() => setUnlockTarget(lock.fsn)}
                  >
                    Force unlock
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.locks.length === 0 && <p className="p-4 text-gray-500">No active locks right now.</p>}
      </div>

      {unlockTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full space-y-4">
            <h3 className="font-semibold">Force unlock {unlockTarget}</h3>
            <p className="text-sm text-gray-600">
              This releases the lock immediately, even if the labourer is still actively working
              it. Fully audited — a reason is required.
            </p>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-2 text-sm"
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
            {actionError && <p className="text-red-600 text-sm">{actionError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 rounded-lg text-sm text-gray-600"
                onClick={() => {
                  setUnlockTarget(null);
                  setReason("");
                  setActionError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
                disabled={!reason.trim() || submitting}
                onClick={() => void handleForceUnlock()}
              >
                {submitting ? "Unlocking…" : "Force unlock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
