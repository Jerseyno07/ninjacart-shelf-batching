import { useNavigate } from "react-router-dom";
import { usePolling } from "../hooks/usePolling.js";
import { fetchFsnList } from "../api/endpoints.js";
import { OfflineBanner } from "../components/OfflineBanner.js";
import { useAuth } from "../auth/AuthContext.js";

export function FsnListPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { data, lastUpdatedAt, isOffline, error } = usePolling(fetchFsnList, 7000);

  return (
    <div className="min-h-screen flex flex-col">
      <OfflineBanner isOffline={isOffline} lastUpdatedAt={lastUpdatedAt} />

      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h1 className="text-lg font-bold">FSNs needing demand</h1>
          <p className="text-xs text-gray-400">{user?.name}</p>
        </div>
        <button className="text-sm text-gray-400 underline" onClick={logout}>
          Log out
        </button>
      </header>

      {error && <p className="p-4 text-red-400 text-sm">Could not load FSN list: {error.message}</p>}

      {!data && !error && <p className="p-4 text-gray-400">Loading…</p>}

      {data && data.fsns.length === 0 && (
        <p className="p-4 text-gray-400">No outstanding demand right now.</p>
      )}

      <ul className="flex-1 overflow-y-auto divide-y divide-gray-800">
        {data?.fsns.map((fsn) => (
          <li key={fsn.fsn}>
            <button
              className="w-full flex items-center justify-between px-4 py-4 active:bg-gray-800 text-left"
              onClick={() => navigate(`/fsns/${encodeURIComponent(fsn.fsn)}`)}
            >
              <div>
                <p className="font-semibold">{fsn.fsn}</p>
                <p className="text-xs text-gray-400">{fsn.darkstoreCount} darkstores</p>
              </div>
              <span className="text-lg font-bold tabular-nums">{fsn.totalRemaining}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
