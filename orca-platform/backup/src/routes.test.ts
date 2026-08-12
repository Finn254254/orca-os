import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClusterConfigSchema } from "@orca/shared";
import { BackupService } from "./backupService.js";
import { createBackupRouter } from "./routes.js";
import { BackupStore } from "./store.js";

describe("backup router", () => {
  let dataDir: string;
  let backupDir: string;
  let app: express.Express;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "orca-backup-routes-data-"));
    backupDir = await mkdtemp(join(tmpdir(), "orca-backup-routes-artifacts-"));
    const store = new BackupStore(dataDir);
    await store.init();
    const service = new BackupService({
      store,
      backupDir,
      getClusterConfig: async () => ClusterConfigSchema.parse({}),
      getAppManifest: async () => undefined,
    });
    app = express();
    app.use(express.json());
    app.use("/api/v1/backups", createBackupRouter(service));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("runs a cluster-config backup and retrieves it", async () => {
    const create = await request(app).post("/api/v1/backups").send({ kind: "cluster-config" });
    expect(create.status).toBe(202);
    expect(create.body.state).toBe("succeeded");
    expect((await request(app).get(`/api/v1/backups/${create.body.id}`)).status).toBe(200);
  });

  it("rejects an invalid backup request", async () => {
    expect((await request(app).post("/api/v1/backups").send({})).status).toBe(400);
  });

  it("404s for an unknown backup job", async () => {
    expect((await request(app).get("/api/v1/backups/backup_nope")).status).toBe(404);
  });

  it("creates and deletes a schedule", async () => {
    const create = await request(app).post("/api/v1/backups/schedules").send({ kind: "cluster-config", intervalMs: 60000 });
    expect(create.status).toBe(201);
    expect((await request(app).get("/api/v1/backups/schedules/list")).body).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/backups/schedules/${create.body.id}`)).status).toBe(204);
  });

  it("records a restore and rejects one for a nonexistent backup", async () => {
    const backup = await request(app).post("/api/v1/backups").send({ kind: "cluster-config" });
    const restore = await request(app).post("/api/v1/backups/restores").send({ backupJobId: backup.body.id, restoredBy: "admin" });
    expect(restore.status).toBe(201);
    expect((await request(app).get("/api/v1/backups/restores/list")).body).toHaveLength(1);

    const bad = await request(app).post("/api/v1/backups/restores").send({ backupJobId: "backup_nope", restoredBy: "admin" });
    expect(bad.status).toBe(400);
  });
});
