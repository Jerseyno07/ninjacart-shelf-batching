import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { LoginPage } from "./pages/LoginPage.js";
import { FsnListPage } from "./pages/FsnListPage.js";
import { FsnDetailPage } from "./pages/FsnDetailPage.js";
import { startSyncLoop } from "./offline/syncQueue.js";

export function App() {
  useEffect(() => startSyncLoop(), []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/fsns" element={<FsnListPage />} />
            <Route path="/fsns/:fsn" element={<FsnDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/fsns" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
