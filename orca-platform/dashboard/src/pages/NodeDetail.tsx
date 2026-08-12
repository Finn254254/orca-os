import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Layout } from "../components/Layout.js";
import { Meter } from "../components/Meter.js";
import { StatusPill } from "../components/StatusPill.js";
import { api, ApiError } from "../api.js";
import { useRealtime } from "../realtime.js";
import type { LiveNode } from "../hooks/useNodes.js";

export function NodeDetail() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<LiveNode | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [commandStatus, setCommandStatus] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    api
      .get<LiveNode>(`/api/v1/nodes/${id}`)
      .then((n) => !cancelled && setNode(n))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useRealtime((event) => {
    if (event.channel === "node" && event.data.id === id) {
      setNode((prev) => (prev ? { ...prev, ...event.data } : { ...event.data, connected: true }));
    } else if (event.channel === "metrics" && event.data.nodeId === id) {
      setNode((prev) => (prev ? { ...prev, lastMetrics: event.data.metrics } : prev));
    }
  });

  async function sendPing() {
    setCommandStatus("sending…");
    try {
      const command = await api.post<{ id: string }>(`/api/v1/nodes/${id}/commands`, { type: "ping", payload: {} });
      setCommandStatus(`sent (command ${command.id}) — check /api/v1/commands/${command.id} for the result`);
    } catch (err) {
      setCommandStatus(err instanceof ApiError ? `failed: ${err.message}` : "failed");
    }
  }

  if (error) {
    return (
      <Layout title="Node">
        <p className="error-text">{error}</p>
      </Layout>
    );
  }
  if (!node) {
    return (
      <Layout title="Node">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  const m = node.lastMetrics;
  const ramPct = m?.ramUsedBytes !== undefined && m.ramTotalBytes ? (m.ramUsedBytes / m.ramTotalBytes) * 100 : undefined;

  return (
    <Layout title={node.name} actions={<button onClick={sendPing}>Send ping</button>}>
      {commandStatus && <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>{commandStatus}</p>}
      <div className="stat-grid">
        <div className="card">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <StatusPill status={node.status} />
            </dd>
            <dt>Group</dt>
            <dd>{node.group}</dd>
            <dt>Node ID</dt>
            <dd>{node.id}</dd>
            <dt>Mesh connected</dt>
            <dd>{node.connected ? "yes" : "no"}</dd>
            <dt>Registered</dt>
            <dd>{new Date(node.registeredAt).toLocaleString()}</dd>
            <dt>Last heartbeat</dt>
            <dd>{node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleString() : "-"}</dd>
          </dl>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>CPU</dt>
            <dd>{node.capabilities?.cpuModel ?? "-"}</dd>
            <dt>Cores</dt>
            <dd>{node.capabilities?.cpuCores ?? "-"}</dd>
            <dt>OS</dt>
            <dd>
              {node.capabilities?.osName} {node.capabilities?.osVersion}
            </dd>
            <dt>Orca version</dt>
            <dd>{node.capabilities?.orcaVersion ?? "-"}</dd>
            <dt>GPUs</dt>
            <dd>{node.capabilities?.gpus?.length ? node.capabilities.gpus.map((g) => g.model).join(", ") : "none"}</dd>
          </dl>
        </div>
      </div>

      <h2 style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 8 }}>Live metrics</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        {!m ? (
          <p className="muted">No metrics reported yet.</p>
        ) : (
          <>
            <div className="kv" style={{ marginBottom: 12 }}>
              <dt>CPU</dt>
              <dd>
                <Meter pct={m.cpuUtilizationPct} />
              </dd>
              <dt>RAM</dt>
              <dd>
                <Meter pct={ramPct} />
              </dd>
              <dt>Uptime</dt>
              <dd>{m.uptimeSeconds !== undefined ? `${Math.round(m.uptimeSeconds / 60)} min` : "-"}</dd>
            </div>
            {m.disks.length > 0 && (
              <table style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Mount</th>
                    <th>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {m.disks.map((d) => (
                    <tr key={d.mount}>
                      <td>{d.mount}</td>
                      <td>
                        <Meter pct={(d.usedBytes / d.totalBytes) * 100} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {Object.keys(m.temperatures).length > 0 && (
              <p className="muted">
                Temperatures: {Object.entries(m.temperatures).map(([k, v]) => `${k}: ${v}°C`).join(", ")}
              </p>
            )}
          </>
        )}
      </div>

      <h2 style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 8 }}>Services</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {(node.services ?? []).length === 0 ? (
            <tr>
              <td colSpan={2} className="muted">
                No services reported.
              </td>
            </tr>
          ) : (
            node.services.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.state}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Layout>
  );
}
