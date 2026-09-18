import { usePolling } from "../hooks/usePolling.js";
import { fetchDashboardSummary } from "../api/endpoints.js";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { data, isOffline, loading, error } = usePolling(fetchDashboardSummary, 10000);

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">Could not load dashboard: {error.message}</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
      {isOffline && <p className="text-amber-600 text-sm mb-4">Offline — showing last-known data.</p>}

      <div className="grid grid-cols-3 gap-4 mt-6">
        <StatCard
          label="Overall completion"
          value={data?.completion ? `${data.completion.percentComplete}%` : "—"}
          sub={
            data?.completion
              ? `${data.completion.totalBatched} / ${data.completion.totalRequired} units`
              : "No completed demand batch yet"
          }
        />
        <StatCard label="Active locks" value={String(data?.activeLockCount ?? 0)} />
        <StatCard
          label="Latest ingestion"
          value={data?.latestIngestion?.status ?? "—"}
          sub={
            data?.latestIngestion
              ? `${data.latestIngestion.filename} · ${data.latestIngestion.validRows} valid, ${data.latestIngestion.rejectedRows} rejected`
              : "No demand file uploaded yet"
          }
        />
      </div>
    </div>
  );
}
