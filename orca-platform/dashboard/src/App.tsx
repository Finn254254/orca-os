import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api.js";
import { Apps } from "./pages/Apps.js";
import { ComingSoon } from "./pages/ComingSoon.js";
import { Jobs } from "./pages/Jobs.js";
import { Login } from "./pages/Login.js";
import { Models } from "./pages/Models.js";
import { NodeDetail } from "./pages/NodeDetail.js";
import { Nodes } from "./pages/Nodes.js";
import { Overview } from "./pages/Overview.js";
import { Settings } from "./pages/Settings.js";
import { Storage } from "./pages/Storage.js";

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
            <Jobs />
          </RequireAuth>
        }
      />
      <Route
        path="/models"
        element={
          <RequireAuth>
            <Models />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs"
        element={
          <RequireAuth>
            <Jobs />
          </RequireAuth>
        }
      />
      <Route
        path="/storage"
        element={
          <RequireAuth>
            <Storage />
          </RequireAuth>
        }
      />
      <Route
        path="/apps"
        element={
          <RequireAuth>
            <Apps />
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
