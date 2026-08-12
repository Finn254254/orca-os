import { useEffect, useState } from "react";
import { Layout } from "../components/Layout.js";
import { Meter } from "../components/Meter.js";
import { StatTile } from "../components/StatTile.js";
import { api } from "../api.js";
import { bytesToHuman } from "../format.js";

interface StorageDevice {
  nodeId: string;
  nodeName: string;
  mount: string;
  totalBytes: number;
  usedBytes: number;
  usedPct: number;
  health: "healthy" | "warning" | "critical";
}

interface ClusterCapacity {
  totalBytes: number;
  usedBytes: number;
  usedPct: number;
  deviceCount: number;
  nodeCount: number;
}

export function Storage() {
  const [devices, setDevices] = useState<StorageDevice[]>([]);
  const [capacity, setCapacity] = useState<ClusterCapacity | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    function load() {
      Promise.all([api.get<StorageDevice[]>("/api/v1/storage/devices"), api.get<ClusterCapacity>("/api/v1/storage/capacity")])
        .then(([d, c]) => {
          if (!cancelled) {
            setDevices(d);
            setCapacity(c);
          }
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Layout title="Storage">
      {error && <p className="error-text">{error}</p>}
      <div className="stat-grid">
        <StatTile label="Total capacity" value={capacity ? bytesToHuman(capacity.totalBytes) : "-"} />
        <StatTile label="Used" value={capacity ? `${capacity.usedPct}%` : "-"} />
        <StatTile label="Devices" value={capacity?.deviceCount ?? 0} />
        <StatTile label="Nodes" value={capacity?.nodeCount ?? 0} />
      </div>
      {devices.length === 0 ? (
        <p className="muted">No disks reported yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Node</th>
              <th>Mount</th>
              <th>Used</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={`${d.nodeId}-${d.mount}`}>
                <td>{d.nodeName}</td>
                <td>{d.mount}</td>
                <td>
                  <Meter pct={d.usedPct} />
                </td>
                <td className={d.health === "critical" ? "status-offline" : d.health === "warning" ? "status-degraded" : "status-online"}>
                  {d.health}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
