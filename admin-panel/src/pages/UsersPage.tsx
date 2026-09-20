import { useState, type FormEvent } from "react";
import { usePolling } from "../hooks/usePolling.js";
import { fetchUsers, createUser, updateUser } from "../api/endpoints.js";
import { ApiError, NetworkError } from "../api/client.js";
import type { AdminUser } from "../api/types.js";
import { BulkUserUploadCard } from "../components/BulkUserUploadCard.js";

export function UsersPage() {
  const { data, error, loading, refetch } = usePolling(fetchUsers, 15000);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("labour");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createUser({ name, username, password, role });
      setName("");
      setUsername("");
      setPassword("");
      setRole("labour");
      refetch();
    } catch (err) {
      if (err instanceof NetworkError) setCreateError("No connection — check your network.");
      else if (err instanceof ApiError) setCreateError(err.message);
      else setCreateError("Could not create user.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    setTogglingId(user.id);
    try {
      await updateUser(user.id, { active: !user.active });
      refetch();
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (error) return <p className="text-red-600">Could not load users: {error.message}</p>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Users</h2>

      <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-semibold mb-3">Create user</h3>
        <div className="grid grid-cols-4 gap-3">
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Password (min 8 chars)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as AdminUser["role"])}
          >
            <option value="labour">Labour</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {createError && <p className="text-red-600 text-sm mt-3">{createError}</p>}
        <button
          type="submit"
          disabled={creating}
          className="mt-3 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create user"}
        </button>
      </form>

      <div className="mb-6">
        <BulkUserUploadCard onSuccess={refetch} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Username</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((user) => (
              <tr key={user.id} className="border-t border-gray-100">
                <td className="px-4 py-2">{user.name}</td>
                <td className="px-4 py-2">{user.username}</td>
                <td className="px-4 py-2 capitalize">{user.role}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${
                      user.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {user.active ? "active" : "inactive"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    className="text-sm underline text-gray-600 disabled:opacity-50"
                    disabled={togglingId === user.id}
                    onClick={() => void handleToggleActive(user)}
                  >
                    {user.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
