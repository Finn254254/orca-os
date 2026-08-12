import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { StorageService } from "./storageService.js";
import { StorageStore } from "./store.js";

class FakeControlPort implements ControlPort {
  constructor(private readonly nodes: NodeRecord[]) {}
  async listNodes() {
    return this.nodes;
  }
}

function nodeWithDisk(id: string, name: string, totalBytes: number, usedBytes: number): NodeRecord {
  return {
    id,
    name,
    group: "default",
    status: "online",
    services: [],
    registeredAt: now(),
    labels: {},
    lastMetrics: {
      timestamp: now(),
      disks: [{ mount: "/", device: "/dev/sda", totalBytes, usedBytes, filesystem: "ext4" }],
      network: [],
      gpus: [],
      temperatures: {},
    },
  };
}

describe("StorageService", () => {
  let dir: string;
  let store: StorageStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-storage-"));
    store = new StorageStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("aggregates disk devices from node metrics with computed free space", async () => {
    const control = new FakeControlPort([nodeWithDisk("n1", "node-1", 1000, 300)]);
    const service = new StorageService(control, store);
    const devices = await service.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ nodeId: "n1", totalBytes: 1000, usedBytes: 300, freeBytes: 700, usedPct: 30, health: "healthy" });
  });

  it("classifies device health by usage thresholds", async () => {
    const control = new FakeControlPort([
      nodeWithDisk("healthy", "healthy-node", 1000, 500),
      nodeWithDisk("warn", "warn-node", 1000, 920),
      nodeWithDisk("crit", "crit-node", 1000, 980),
    ]);
    const service = new StorageService(control, store);
    const devices = await service.listDevices();
    expect(devices.find((d) => d.nodeId === "healthy")?.health).toBe("healthy");
    expect(devices.find((d) => d.nodeId === "warn")?.health).toBe("warning");
    expect(devices.find((d) => d.nodeId === "crit")?.health).toBe("critical");
  });

  it("computes cluster-wide capacity across all devices", async () => {
    const control = new FakeControlPort([nodeWithDisk("n1", "node-1", 1000, 400), nodeWithDisk("n2", "node-2", 2000, 600)]);
    const service = new StorageService(control, store);
    const capacity = await service.clusterCapacity();
    expect(capacity).toMatchObject({ totalBytes: 3000, usedBytes: 1000, freeBytes: 2000, deviceCount: 2, nodeCount: 2 });
    expect(capacity.usedPct).toBeCloseTo(33.3, 1);
  });

  it("returns zeroed capacity when no nodes report disks", async () => {
    const service = new StorageService(new FakeControlPort([]), store);
    const capacity = await service.clusterCapacity();
    expect(capacity).toMatchObject({ totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPct: 0, deviceCount: 0, nodeCount: 0 });
  });

  it("manages storage pools", async () => {
    const service = new StorageService(new FakeControlPort([]), store);
    const pool = await service.createPool({ name: "fast-tier", nodeIds: ["n1", "n2"] });
    expect(service.listPools()).toHaveLength(1);
    expect(await service.deletePool(pool.id)).toBe(true);
    expect(service.listPools()).toHaveLength(0);
    expect(await service.deletePool(pool.id)).toBe(false);
  });

  it("manages named storage locations for models/datasets/app-data/backups", async () => {
    const service = new StorageService(new FakeControlPort([]), store);
    await service.createLocation({ kind: "model", nodeId: "n1", path: "/data/models" });
    await service.createLocation({ kind: "backup", nodeId: "n2", path: "/data/backups" });
    expect(service.listLocations()).toHaveLength(2);
    expect(service.listLocations("model")).toHaveLength(1);
    expect(service.listLocations("backup")[0].path).toBe("/data/backups");
  });
});
