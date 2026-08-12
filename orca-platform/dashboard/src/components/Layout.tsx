import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { clearSession, getStoredUser } from "../api.js";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/nodes", label: "Nodes" },
  { to: "/compute", label: "Compute" },
  { to: "/models", label: "Models" },
  { to: "/jobs", label: "Jobs" },
  { to: "/storage", label: "Storage" },
  { to: "/apps", label: "Applications" },
  { to: "/logs", label: "Logs" },
  { to: "/settings", label: "Settings" },
];

export function Layout({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const user = getStoredUser();
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-brand">Orca</div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {item.label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        {user && (
          <div style={{ padding: "8px", fontSize: 12 }}>
            <div className="muted">{user.username}</div>
            <button
              className="secondary"
              style={{ marginTop: 6, width: "100%" }}
              onClick={() => {
                clearSession();
                window.location.href = "/login";
              }}
            >
              Log out
            </button>
          </div>
        )}
      </nav>
      <main className="main">
        <div className="topbar">
          <h1>{title}</h1>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
