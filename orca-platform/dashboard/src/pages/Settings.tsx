import { useEffect, useState } from "react";
import type { ClusterConfig, UserRole } from "@orca/shared";
import { Layout } from "../components/Layout.js";
import { api, getStoredUser } from "../api.js";

interface PublicUserLike {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export function Settings() {
  const me = getStoredUser();
  const [config, setConfig] = useState<ClusterConfig | undefined>();
  const [users, setUsers] = useState<PublicUserLike[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "viewer" as UserRole });

  function reload() {
    api.get<ClusterConfig>("/api/v1/cluster/config").then(setConfig).catch((err) => setError(String(err)));
    if (me?.role === "admin") {
      api
        .get<PublicUserLike[]>("/api/v1/users")
        .then(setUsers)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }

  useEffect(reload, [me?.role]);

  async function createUser() {
    setError(undefined);
    try {
      await api.post("/api/v1/users", newUser);
      setNewUser({ username: "", password: "", role: "viewer" });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteUser(id: string) {
    try {
      await api.delete(`/api/v1/users/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Layout title="Settings">
      {error && <p className="error-text">{error}</p>}

      <h2 style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 8 }}>Cluster</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        {config ? (
          <dl className="kv">
            <dt>Name</dt>
            <dd>{config.clusterName}</dd>
            <dt>Heartbeat interval</dt>
            <dd>{config.heartbeatIntervalMs} ms</dd>
            <dt>Heartbeat timeout</dt>
            <dd>{config.heartbeatTimeoutMs} ms</dd>
            <dt>Groups</dt>
            <dd>{config.groups.map((g) => g.name).join(", ")}</dd>
          </dl>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>

      <h2 style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 8 }}>Users</h2>
      {me?.role !== "admin" ? (
        <p className="muted">User management requires an admin account.</p>
      ) : (
        <div className="card">
          <table style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.role}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    {u.id !== me.id && (
                      <button className="secondary" onClick={() => deleteUser(u.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              placeholder="username"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            />
            <input
              placeholder="password"
              type="password"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}>
              <option value="viewer">viewer</option>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
            </select>
            <button onClick={createUser} disabled={!newUser.username || !newUser.password}>
              Add user
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

