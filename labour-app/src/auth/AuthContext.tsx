import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const { token, user: storedUser } = JSON.parse(raw);
        setAuthToken(token);
        setUser(storedUser);
      }
    } catch {
      // Corrupt/blocked storage — fall through to logged-out state.
    }
  }, []);

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
