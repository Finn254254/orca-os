import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api.js";
import { ComingSoon } from "./pages/ComingSoon.js";
import { Login } from "./pages/Login.js";
import { NodeDetail } from "./pages/NodeDetail.js";
import { Nodes } from "./pages/Nodes.js";
import { Overview } from "./pages/Overview.js";
import { Settings } from "./pages/Settings.js";

function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Overview />
          </RequireAuth>
        }
      />
      <Route
        path="/nodes"
        element={
          <RequireAuth>
            <Nodes />
          </RequireAuth>
        }
      />
      <Route
        path="/nodes/:id"
        element={
          <RequireAuth>
            <NodeDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/compute"
        element={
          <RequireAuth>
            <ComingSoon title="Compute" phase="Phase 9" />
          </RequireAuth>
        }
      />
      <Route
        path="/models"
        element={
          <RequireAuth>
            <ComingSoon title="Models" phase="Phase 11" />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs"
        element={
          <RequireAuth>
            <ComingSoon title="Jobs" phase="Phase 9" />
          </RequireAuth>
        }
      />
      <Route
        path="/storage"
        element={
          <RequireAuth>
            <ComingSoon title="Storage" phase="Phase 14" />
          </RequireAuth>
        }
      />
      <Route
        path="/apps"
        element={
          <RequireAuth>
            <ComingSoon title="Applications" phase="Phase 13 (Orca Deploy)" />
          </RequireAuth>
        }
      />
      <Route
        path="/logs"
        element={
          <RequireAuth>
            <ComingSoon title="Logs" phase="Phase 9+ (once Compute/Backup produce them)" />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
