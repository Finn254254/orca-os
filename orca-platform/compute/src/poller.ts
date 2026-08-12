import type { JobService } from "./jobService.js";

/** Periodically checks running jobs' dispatched commands for completion. */
export function startJobPoller(jobs: JobService, intervalMs = 1000): () => void {
  const interval = setInterval(() => void jobs.pollOnce(), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
