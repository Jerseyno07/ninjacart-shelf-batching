import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError, NetworkError } from "../api/client.js";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate("/fsns", { replace: true });
    } catch (err) {
      if (err instanceof NetworkError) {
        setError("No connection — check your network and try again.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center mb-6">Shelf Batching</h1>

        <div>
          <label className="block text-sm mb-1" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-lg bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 font-semibold text-base"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
