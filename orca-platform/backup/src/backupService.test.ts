import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClusterConfigSchema, type AppManifest } from "@orca/shared";
import { BackupService } from "./backupService.js";
import { BackupStore } from "./store.js";

describe("BackupService", () => {
  let dataDir: string;
  let backupDir: string;
  let store: BackupStore;
  let service: BackupService;
  let manifests: Record<string, AppManifest>;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "orca-backup-data-"));
    backupDir = await mkdtemp(join(tmpdir(), "orca-backup-artifacts-"));
    store = new BackupStore(dataDir);
    await store.init();
    manifests = {
      app_1: { name: "web", version: "1.0", image: "nginx", ports: [], volumes: [], env: {}, resources: {}, targetCapabilities: [], restartPolicy: "on-failure" },
    };
    service = new BackupService({
      store,
      backupDir,
      getClusterConfig: async () => ClusterConfigSchema.parse({ clusterName: "test-cluster" }),
      getAppManifest: async (id) => manifests[id],
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("writes a real cluster-config backup file", async () => {
    const job = await service.runBackup("cluster-config");
    expect(job.state).toBe("succeeded");
    expect(job.location).toBeTruthy();
    const content = JSON.parse(await readFile(job.location!, "utf-8"));
    expect(content.clusterName).toBe("test-cluster");
    expect(job.sizeBytes).toBeGreaterThan(0);
  });

  it("writes a real app-config backup file for a known deployment", async () => {
    const job = await service.runBackup("app-config", "app_1");
    expect(job.state).toBe("succeeded");
    const content = JSON.parse(await readFile(job.location!, "utf-8"));
    expect(content.name).toBe("web");
  });

  it("fails an app-config backup for an unknown deployment", async () => {
    const job = await service.runBackup("app-config", "app_missing");
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/no deployment found/);
  });

  it("fails an app-config backup with no targetId", async () => {
    const job = await service.runBackup("app-config");
    expect(job.state).toBe("failed");
  });

  it("fails app-data backups with a clear architecture-only reason", async () => {
    const job = await service.runBackup("app-data", "app_1");
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/architecture-only/);
  });

  it("records and lists restores only for succeeded backups", async () => {
    const job = await service.runBackup("cluster-config");
    const restore = await service.recordRestore({ backupJobId: job.id, restoredBy: "admin" });
    expect(service.listRestores()).toHaveLength(1);
    expect(restore.backupJobId).toBe(job.id);

    const failedJob = await service.runBackup("app-config"); // no targetId -> fails
    await expect(service.recordRestore({ backupJobId: failedJob.id, restoredBy: "admin" })).rejects.toThrow(/did not succeed/);
  });

  it("manages backup schedules and runs due ones via pollSchedules", async () => {
    const schedule = await service.createSchedule({ kind: "cluster-config", intervalMs: 1, enabled: true });
    expect(service.listSchedules()).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 5));
    await service.pollSchedules();
    expect(service.listJobs().some((j) => j.kind === "cluster-config")).toBe(true);

    expect(await service.deleteSchedule(schedule.id)).toBe(true);
    expect(service.listSchedules()).toHaveLength(0);
  });

  it("does not run a disabled schedule", async () => {
    await service.createSchedule({ kind: "cluster-config", intervalMs: 1, enabled: false });
    await new Promise((r) => setTimeout(r, 5));
    await service.pollSchedules();
    expect(service.listJobs()).toHaveLength(0);
  });
});
