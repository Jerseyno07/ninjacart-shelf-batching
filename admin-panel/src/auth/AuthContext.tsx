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

const STORAGE_KEY = "shelf-batching-admin-auth";

function restoreFromStorage(): AuthenticatedUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { token, user: storedUser } = JSON.parse(raw);
    setAuthToken(token);
    return storedUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restored synchronously in the initializer, not a useEffect — see
  // labour-app/src/auth/AuthContext.tsx for why: a useEffect runs after the
  // first render, so a route guard checking `user` on that first render
  // would redirect to /login before the effect ever restored the session.
  const [user, setUser] = useState<AuthenticatedUser | null>(restoreFromStorage);

  const login = useCallback(async (username: string, password: string) => {
    const { token, user: loggedInUser } = await loginRequest(username, password);

    if (loggedInUser.role === "labour") {
      // This app is admin/supervisor only. The backend would reject every
      // subsequent admin-only call anyway (403), but failing here gives a
      // clear message instead of a labourer staring at a broken dashboard.
      throw new Error("This account doesn't have access to the admin panel.");
    }

    setAuthToken(token);
    setUser(loggedInUser);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user: loggedInUser }));
    } catch {
      // Best-effort persistence only.
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
