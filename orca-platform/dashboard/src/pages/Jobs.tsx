import { useEffect, useState } from "react";
import { Layout } from "../components/Layout.js";
import { api } from "../api.js";

interface JobSummary {
  id: string;
  spec: { type: string; command?: string[] };
  state: string;
  assignedNodeId?: string;
  schedulingReason?: string;
  failureReason?: string;
  createdAt: string;
}

const REFRESH_MS = 2000;

export function Jobs() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    function load() {
      api
        .get<JobSummary[]>("/api/v1/jobs")
        .then((result) => !cancelled && setJobs(result))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Layout title="Jobs">
      {error && <p className="error-text">{error}</p>}
      {jobs.length === 0 ? (
        <p className="muted">
          No jobs yet. Submit one with <code>orca run &lt;command...&gt;</code> or <code>POST /api/v1/jobs</code>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>State</th>
              <th>Node</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.id}</td>
                <td>{j.spec.type}</td>
                <td>{j.state}</td>
                <td>{j.assignedNodeId ?? "-"}</td>
                <td>{new Date(j.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
