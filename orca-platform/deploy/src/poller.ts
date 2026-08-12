import type { DeployService } from "./deployService.js";

/** Periodically checks in-progress deployments' dispatched commands for completion. */
export function startDeployPoller(deploy: DeployService, intervalMs = 1000): () => void {
  const interval = setInterval(() => void deploy.pollOnce(), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
