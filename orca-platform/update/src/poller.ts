import type { UpdateService } from "./updateService.js";

/** Periodically checks in-progress rollouts' dispatched update commands for completion. */
export function startUpdatePoller(update: UpdateService, intervalMs = 1000): () => void {
  const interval = setInterval(() => void update.pollOnce(), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
