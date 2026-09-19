import { Fragment, useCallback, useState } from "react";
import { usePolling } from "../hooks/usePolling.js";
import { fetchFsnList, fetchAdminDarkstoresForFsn } from "../api/endpoints.js";
import type { DarkstoreRow } from "../api/types.js";

export function FsnCompletionPage() {
  const { data, error, loading } = usePolling(fetchFsnList, 10000);
  const [expandedFsn, setExpandedFsn] = useState<string | null>(null);
  const [darkstores, setDarkstores] = useState<DarkstoreRow[]>([]);
  const [loadingDarkstores, setLoadingDarkstores] = useState(false);

  const toggleFsn = useCallback(
    async (fsn: string) => {
      if (expandedFsn === fsn) {
        setExpandedFsn(null);
        return;
      }
      setExpandedFsn(fsn);
      setLoadingDarkstores(true);
      try {
        const { darkstores: rows } = await fetchAdminDarkstoresForFsn(fsn);
        setDarkstores(rows);
      } finally {
        setLoadingDarkstores(false);
      }
    },
    [expandedFsn]
  );

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">Could not load FSN list: {error.message}</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">FSN Completion</h2>
      <p className="text-sm text-gray-500 mb-4">
        Read-only — doesn't require or affect the FSN lock a labourer might be holding.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">FSN</th>
              <th className="px-4 py-2">Darkstores</th>
              <th className="px-4 py-2">Remaining</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.fsns.map((fsn) => (
              <Fragment key={fsn.fsn}>
                <tr className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{fsn.fsn}</td>
                  <td className="px-4 py-2">{fsn.darkstoreCount}</td>
                  <td className="px-4 py-2 tabular-nums">{fsn.totalRemaining}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-sm underline text-gray-600"
                      onClick={() => void toggleFsn(fsn.fsn)}
                    >
                      {expandedFsn === fsn.fsn ? "Hide" : "View"} darkstores
                    </button>
                  </td>
                </tr>
                {expandedFsn === fsn.fsn && (
                  <tr className="border-t border-gray-100 bg-gray-50">
                    <td colSpan={4} className="px-4 py-3">
                      {loadingDarkstores ? (
                        <p className="text-gray-500">Loading…</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="text-left text-gray-500">
                            <tr>
                              <th className="py-1 pr-4">Darkstore</th>
                              <th className="py-1 pr-4">Required</th>
                              <th className="py-1 pr-4">Batched On Flash</th>
                              <th className="py-1 pr-4">Batched</th>
                              <th className="py-1 pr-4">Remaining</th>
                            </tr>
                          </thead>
                          <tbody>
                            {darkstores.map((ds) => (
                              <tr key={ds.darkstoreId} className="border-t border-gray-200">
                                <td className="py-1 pr-4">{ds.darkstoreId}</td>
                                <td className="py-1 pr-4">{ds.qtyRequired}</td>
                                <td className="py-1 pr-4">{ds.batchedOnFlash}</td>
                                <td className="py-1 pr-4">{ds.qtyBatched}</td>
                                <td className="py-1 pr-4">{ds.remaining}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data?.fsns.length === 0 && (
          <p className="p-4 text-gray-500">No outstanding demand right now.</p>
        )}
      </div>
    </div>
  );
}
