import { Layout } from "../components/Layout.js";
import { StatTile } from "../components/StatTile.js";
import { NodeTable } from "../components/NodeTable.js";
import { useNodes } from "../hooks/useNodes.js";

export function Overview() {
  const { nodes, loading, error } = useNodes();
  const online = nodes.filter((n) => n.status === "online").length;
  const offline = nodes.length - online;

  const withRam = nodes.filter((n) => n.lastMetrics?.ramTotalBytes);
  const ramUsed = withRam.reduce((sum, n) => sum + (n.lastMetrics?.ramUsedBytes ?? 0), 0);
  const ramTotal = withRam.reduce((sum, n) => sum + (n.lastMetrics?.ramTotalBytes ?? 0), 0);

  const withCpu = nodes.filter((n) => n.lastMetrics?.cpuUtilizationPct !== undefined);
  const avgCpu = withCpu.length
    ? withCpu.reduce((sum, n) => sum + (n.lastMetrics?.cpuUtilizationPct ?? 0), 0) / withCpu.length
    : undefined;

  return (
    <Layout title="Cluster Overview">
      {error && <p className="error-text">{error}</p>}
      <div className="stat-grid">
        <StatTile label="Nodes" value={nodes.length} />
        <StatTile label="Online" value={online} />
        <StatTile label="Offline" value={offline} />
        <StatTile label="Avg CPU" value={avgCpu !== undefined ? `${avgCpu.toFixed(0)}%` : "-"} />
        <StatTile label="RAM used" value={ramTotal ? `${((ramUsed / ramTotal) * 100).toFixed(0)}%` : "-"} />
      </div>
      <h2 style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 8 }}>Nodes</h2>
      {loading ? <p className="muted">Loading…</p> : <NodeTable nodes={nodes} />}
    </Layout>
  );
}
