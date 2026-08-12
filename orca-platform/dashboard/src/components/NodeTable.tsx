import { useNavigate } from "react-router-dom";
import { Meter } from "./Meter.js";
import { StatusPill } from "./StatusPill.js";
import type { LiveNode } from "../hooks/useNodes.js";

export function NodeTable({ nodes }: { nodes: LiveNode[] }) {
  const navigate = useNavigate();
  if (nodes.length === 0) return <p className="muted">No nodes registered yet.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Group</th>
          <th>Status</th>
          <th>CPU</th>
          <th>RAM</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => {
          const ramPct =
            n.lastMetrics?.ramUsedBytes !== undefined && n.lastMetrics.ramTotalBytes
              ? (n.lastMetrics.ramUsedBytes / n.lastMetrics.ramTotalBytes) * 100
              : undefined;
          return (
            <tr key={n.id} className="clickable" onClick={() => navigate(`/nodes/${n.id}`)}>
              <td>{n.name}</td>
              <td>{n.group}</td>
              <td>
                <StatusPill status={n.status} />
              </td>
              <td>
                <Meter pct={n.lastMetrics?.cpuUtilizationPct} />
              </td>
              <td>
                <Meter pct={ramPct} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
