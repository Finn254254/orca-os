import { useEffect, useState } from "react";
import type { NodeRecord } from "@orca/shared";
import { api } from "../api.js";
import { useRealtime } from "../realtime.js";

export type LiveNode = NodeRecord & { connected: boolean };

export function useNodes() {
  const [nodes, setNodes] = useState<LiveNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    api
      .get<LiveNode[]>("/api/v1/nodes")
      .then((result) => {
        if (!cancelled) setNodes(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useRealtime((event) => {
    if (event.channel === "node") {
      setNodes((prev) => {
        const idx = prev.findIndex((n) => n.id === event.data.id);
        const updated: LiveNode = { ...event.data, connected: idx >= 0 ? prev[idx].connected : true };
        if (idx === -1) return [...prev, updated];
        const next = [...prev];
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
    } else if (event.channel === "metrics") {
      setNodes((prev) =>
        prev.map((n) => (n.id === event.data.nodeId ? { ...n, lastMetrics: event.data.metrics } : n)),
      );
    }
  });

  return { nodes, loading, error };
}
