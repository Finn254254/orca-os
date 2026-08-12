import type { BackupService } from "./backupService.js";

/** Periodically checks scheduled backups and runs any that are due. */
export function startBackupScheduler(backup: BackupService, intervalMs = 5000): () => void {
  const interval = setInterval(() => void backup.pollSchedules(), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
