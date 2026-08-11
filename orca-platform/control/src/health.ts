import type { ClusterStore } from "./store.js";

export interface HealthSweeperOptions {
  intervalMs?: number;
  onOffline?: (nodeId: string) => void;
}

/** Periodically marks nodes with a stale heartbeat as offline. */
export function startHealthSweeper(store: ClusterStore, options: HealthSweeperOptions = {}): () => void {
  const interval = setInterval(async () => {
    const offline = await store.sweepStaleNodes();
    for (const nodeId of offline) options.onOffline?.(nodeId);
  }, options.intervalMs ?? 2000);
  interval.unref?.();
  return () => clearInterval(interval);
}
