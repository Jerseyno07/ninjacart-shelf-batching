import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

/** User management is an admin responsibility, not a supervisor one — see
 * docs/00-overview.md / the kickoff spec's role split. */
export function AdminOnlyRoute() {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}
