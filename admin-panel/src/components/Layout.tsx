import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-200"
  }`;

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-gray-300 bg-white p-4 flex flex-col">
        <h1 className="text-lg font-bold mb-6 px-3">Shelf Batching</h1>
        <nav className="flex flex-col gap-1 flex-1">
          <NavLink to="/" className={navLinkClass} end>
            Dashboard
          </NavLink>
          <NavLink to="/demand" className={navLinkClass}>
            Demand Upload
          </NavLink>
          <NavLink to="/fsns" className={navLinkClass}>
            FSN Completion
          </NavLink>
          <NavLink to="/locks" className={navLinkClass}>
            Active Locks
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/users" className={navLinkClass}>
              Users
            </NavLink>
          )}
        </nav>
        <div className="px-3 pt-4 border-t border-gray-200">
          <p className="text-sm font-medium">{user?.name}</p>
          <p className="text-xs text-gray-500 mb-2 capitalize">{user?.role}</p>
          <button className="text-sm text-gray-500 underline" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
