import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { createStorageRouter } from "./routes.js";
import { StorageService } from "./storageService.js";
import { StorageStore } from "./store.js";

class FakeControlPort implements ControlPort {
  async listNodes(): Promise<NodeRecord[]> {
    return [
      {
        id: "n1",
        name: "node-1",
        group: "default",
        status: "online",
        services: [],
        registeredAt: now(),
        labels: {},
        lastMetrics: { timestamp: now(), disks: [{ mount: "/", totalBytes: 1000, usedBytes: 250 }], network: [], gpus: [], temperatures: {} },
      },
    ];
  }
}

describe("storage router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-storage-routes-"));
    const store = new StorageStore(dir);
    await store.init();
    const service = new StorageService(new FakeControlPort(), store);
    app = express();
    app.use(express.json());
    app.use("/api/v1/storage", createStorageRouter(service));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("lists devices and capacity", async () => {
    const devices = await request(app).get("/api/v1/storage/devices");
    expect(devices.body).toHaveLength(1);
    const capacity = await request(app).get("/api/v1/storage/capacity");
    expect(capacity.body.totalBytes).toBe(1000);
  });

  it("creates and deletes a pool", async () => {
    const create = await request(app).post("/api/v1/storage/pools").send({ name: "fast", nodeIds: ["n1"] });
    expect(create.status).toBe(201);
    expect((await request(app).get("/api/v1/storage/pools")).body).toHaveLength(1);
    const del = await request(app).delete(`/api/v1/storage/pools/${create.body.id}`);
    expect(del.status).toBe(204);
  });

  it("rejects an invalid pool", async () => {
    const res = await request(app).post("/api/v1/storage/pools").send({});
    expect(res.status).toBe(400);
  });

  it("creates and filters locations by kind", async () => {
    await request(app).post("/api/v1/storage/locations").send({ kind: "model", nodeId: "n1", path: "/data/models" });
    await request(app).post("/api/v1/storage/locations").send({ kind: "dataset", nodeId: "n1", path: "/data/sets" });
    const all = await request(app).get("/api/v1/storage/locations");
    expect(all.body).toHaveLength(2);
    const models = await request(app).get("/api/v1/storage/locations?kind=model");
    expect(models.body).toHaveLength(1);
  });

  it("404s deleting an unknown pool or location", async () => {
    expect((await request(app).delete("/api/v1/storage/pools/pool_nope")).status).toBe(404);
    expect((await request(app).delete("/api/v1/storage/locations/loc_nope")).status).toBe(404);
  });
});
