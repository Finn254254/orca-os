import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { now, type AppManifest, type ClusterConfig } from "@orca/shared";
import type { BackupStore } from "./store.js";
import type { BackupJob, BackupKind, BackupSchedule, RestoreRecord } from "./types.js";

export interface BackupServiceOptions {
  store: BackupStore;
  backupDir: string;
  getClusterConfig: () => Promise<ClusterConfig>;
  getAppManifest: (deploymentId: string) => Promise<AppManifest | undefined>;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Backup management. `cluster-config` and `app-config` backups are real —
 * they snapshot live data (Control's cluster config; a deployment's
 * manifest) to a JSON file under `backupDir`. `app-data` backups are
 * architecture only for this phase (see the build instructions'
 * "application data backup **architecture**" vs. "application
 * **configuration** backups" distinction) — creating one records a job
 * that fails with a clear reason, since a real data-snapshot mechanism
 * (volume snapshots, rsync, etc.) doesn't exist yet.
 */
export class BackupService {
  private readonly store: BackupStore;
  private readonly backupDir: string;
  private readonly getClusterConfig: () => Promise<ClusterConfig>;
  private readonly getAppManifest: (deploymentId: string) => Promise<AppManifest | undefined>;
  private readonly log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

  constructor(options: BackupServiceOptions) {
    this.store = options.store;
    this.backupDir = options.backupDir;
    this.getClusterConfig = options.getClusterConfig;
    this.getAppManifest = options.getAppManifest;
    this.log = options.logger ?? { info: () => undefined, warn: () => undefined };
  }

  async runBackup(kind: BackupKind, targetId?: string): Promise<BackupJob> {
    const job = await this.store.createJob({ kind, targetId });
    await this.store.updateJob(job.id, { state: "running", startedAt: now() });

    try {
      const payload = await this.collectPayload(kind, targetId);
      const fileName = `${kind}-${targetId ?? "cluster"}-${job.id}.json`;
      const filePath = join(this.backupDir, fileName);
      const serialized = JSON.stringify(payload, null, 2);
      await mkdir(this.backupDir, { recursive: true });
      await writeFile(filePath, serialized, "utf-8");

      const updated = await this.store.updateJob(job.id, {
        state: "succeeded",
        location: filePath,
        sizeBytes: Buffer.byteLength(serialized),
        completedAt: now(),
      });
      this.log.info({ backupId: job.id, kind, filePath }, "backup completed");
      return updated ?? job;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.log.warn({ backupId: job.id, kind, err }, "backup failed");
      const updated = await this.store.updateJob(job.id, { state: "failed", error, completedAt: now() });
      return updated ?? job;
    }
  }

  private async collectPayload(kind: BackupKind, targetId?: string): Promise<unknown> {
    if (kind === "cluster-config") {
      return this.getClusterConfig();
    }
    if (kind === "app-config") {
      if (!targetId) throw new Error("app-config backups require targetId (a deployment id)");
      const manifest = await this.getAppManifest(targetId);
      if (!manifest) throw new Error(`no deployment found for targetId "${targetId}"`);
      return manifest;
    }
    // app-data: architecture only for this phase — no real snapshot mechanism exists yet.
    throw new Error("app-data backups are architecture-only in this phase — no storage snapshot mechanism is implemented yet");
  }

  listJobs(): BackupJob[] {
    return this.store.listJobs();
  }

  getJob(id: string): BackupJob | undefined {
    return this.store.getJob(id);
  }

  createSchedule(input: { kind: BackupKind; targetId?: string; intervalMs: number; enabled: boolean }): Promise<BackupSchedule> {
    return this.store.createSchedule(input);
  }

  listSchedules(): BackupSchedule[] {
    return this.store.listSchedules();
  }

  updateSchedule(id: string, patch: Partial<BackupSchedule>): Promise<BackupSchedule | undefined> {
    return this.store.updateSchedule(id, patch);
  }

  deleteSchedule(id: string): Promise<boolean> {
    return this.store.deleteSchedule(id);
  }

  async recordRestore(input: { backupJobId: string; restoredBy: string; notes?: string }): Promise<RestoreRecord> {
    const job = this.store.getJob(input.backupJobId);
    if (!job) throw new Error(`no backup job "${input.backupJobId}"`);
    if (job.state !== "succeeded") throw new Error(`backup job "${input.backupJobId}" did not succeed — nothing to restore`);
    return this.store.createRestore(input);
  }

  listRestores(): RestoreRecord[] {
    return this.store.listRestores();
  }

  /** Called periodically; runs any enabled schedule whose interval has elapsed. */
  async pollSchedules(): Promise<void> {
    const nowMs = Date.now();
    for (const schedule of this.store.listSchedules()) {
      if (!schedule.enabled) continue;
      const dueAt = schedule.lastRunAt ? new Date(schedule.lastRunAt).getTime() + schedule.intervalMs : 0;
      if (nowMs < dueAt) continue;
      await this.store.updateSchedule(schedule.id, { lastRunAt: now() });
      await this.runBackup(schedule.kind, schedule.targetId);
    }
  }
}
