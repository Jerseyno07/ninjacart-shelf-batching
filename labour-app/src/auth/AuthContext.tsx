import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { setAuthToken } from "../api/client.js";
import { login as loginRequest } from "../api/endpoints.js";
import type { AuthenticatedUser } from "../api/types.js";

interface AuthState {
  user: AuthenticatedUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "shelf-batching-auth";

function restoreFromStorage(): AuthenticatedUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { token, user: storedUser } = JSON.parse(raw);
    setAuthToken(token);
    return storedUser;
  } catch {
    // Corrupt/blocked storage — fall through to logged-out state.
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restored synchronously in the initializer, not a useEffect — a
  // full page reload (common on this app's flaky-network target devices)
  // otherwise renders one frame with user=null before the effect runs,
  // and ProtectedRoute redirects to /login on that frame before the
  // stored session ever gets a chance to load.
  const [user, setUser] = useState<AuthenticatedUser | null>(restoreFromStorage);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user: loggedInUser } = await loginRequest(username, password);
    setAuthToken(token);
    setUser(loggedInUser);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user: loggedInUser }));
    } catch {
      // Best-effort persistence only — staying logged in across a refresh
      // is a convenience, not a correctness requirement.
    }
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
