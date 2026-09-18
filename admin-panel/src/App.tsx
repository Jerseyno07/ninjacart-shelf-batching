import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { AdminOnlyRoute } from "./components/AdminOnlyRoute.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DemandUploadPage } from "./pages/DemandUploadPage.js";
import { FsnCompletionPage } from "./pages/FsnCompletionPage.js";
import { ActiveLocksPage } from "./pages/ActiveLocksPage.js";
import { UsersPage } from "./pages/UsersPage.js";

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/demand" element={<DemandUploadPage />} />
              <Route path="/fsns" element={<FsnCompletionPage />} />
              <Route path="/locks" element={<ActiveLocksPage />} />
              <Route element={<AdminOnlyRoute />}>
                <Route path="/users" element={<UsersPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
