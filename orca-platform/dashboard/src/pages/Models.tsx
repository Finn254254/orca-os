import { useEffect, useState } from "react";
import { Layout } from "../components/Layout.js";
import { api } from "../api.js";

interface ModelSummary {
  id: string;
  name: string;
  runtime: string;
  state: string;
  downloadProgressPct?: number;
}

export function Models() {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .get<ModelSummary[]>("/api/v1/models")
        .then((result) => !cancelled && setModels(result))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Layout title="Models">
      {error && <p className="error-text">{error}</p>}
      <p className="muted" style={{ marginBottom: 16 }}>
        Adapters: Ollama, llama.cpp. Pull a model with <code>orca model-pull &lt;runtime&gt; &lt;name&gt;</code>.
      </p>
      {models.length === 0 ? (
        <p className="muted">No models registered yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Runtime</th>
              <th>State</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.runtime}</td>
                <td>{m.state}</td>
                <td>{m.downloadProgressPct !== undefined ? `${m.downloadProgressPct}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
