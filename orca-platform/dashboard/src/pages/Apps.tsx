import { useEffect, useState } from "react";
import { Layout } from "../components/Layout.js";
import { api } from "../api.js";

interface AppSummary {
  id: string;
  manifest: { name: string; image: string; version: string };
  state: string;
  assignedNodeId?: string;
  createdAt: string;
}

export function Apps() {
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .get<AppSummary[]>("/api/v1/apps")
        .then((result) => !cancelled && setApps(result))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function remove(id: string) {
    await api.delete(`/api/v1/apps/${id}`);
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, state: "stopped" } : a)));
  }

  return (
    <Layout title="Applications">
      {error && <p className="error-text">{error}</p>}
      <p className="muted" style={{ marginBottom: 16 }}>
        Deploy with <code>orca deploy &lt;manifest.json&gt;</code> or <code>POST /api/v1/apps</code>.
      </p>
      {apps.length === 0 ? (
        <p className="muted">No applications deployed yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Image</th>
              <th>State</th>
              <th>Node</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>{a.manifest.name}</td>
                <td>
                  {a.manifest.image}:{a.manifest.version}
                </td>
                <td>{a.state}</td>
                <td>{a.assignedNodeId ?? "-"}</td>
                <td>
                  {a.state === "running" && (
                    <button className="secondary" onClick={() => remove(a.id)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
