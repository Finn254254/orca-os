import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type ClusterConfig, type NodeRecord } from "@orca/shared";
import { AppBackendService, type ClusterPort, type UserDirectory } from "./appBackendService.js";
import { DeviceStore } from "./deviceStore.js";
import { NotificationStore } from "./notificationStore.js";

const CONFIG: ClusterConfig = {
  clusterName: "test-cluster",
  groups: [],
  heartbeatIntervalMs: 1000,
  heartbeatTimeoutMs: 5000,
  settings: {},
};

function node(overrides: Partial<NodeRecord & { connected: boolean }>): NodeRecord & { connected: boolean } {
  return {
    id: "node_1",
    name: "node-1",
    group: "default",
    status: "online",
    services: [],
    registeredAt: now(),
    labels: {},
    capabilities: { cpuCores: 8, gpus: [], tags: [] },
    connected: true,
    ...overrides,
  };
}

class FakeCluster implements ClusterPort {
  constructor(private readonly nodes: (NodeRecord & { connected: boolean })[]) {}
  async getClusterConfig() {
    return CONFIG;
  }
  async listNodes() {
    return this.nodes;
  }
}

class FakeUsers implements UserDirectory {
  constructor(private readonly ids: string[]) {}
  listUserIds() {
    return this.ids;
  }
}

describe("AppBackendService", () => {
  let dir: string;
  let notifications: NotificationStore;
  let devices: DeviceStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-app-backend-"));
    notifications = new NotificationStore(dir);
    await notifications.init();
    devices = new DeviceStore(dir);
    await devices.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function makeService(nodes: (NodeRecord & { connected: boolean })[], userIds: string[] = ["user_1"]) {
    return new AppBackendService({ cluster: new FakeCluster(nodes), users: new FakeUsers(userIds), notifications, devices });
  }

  it("discover returns the cluster's identity", async () => {
    const service = makeService([]);
    const info = await service.discover();
    expect(info).toMatchObject({ service: "orca-api", clusterName: "test-cluster", apiVersion: "v1" });
    expect(info.serverTime).toBeTruthy();
  });

  it("summary aggregates node counts and averages, skipping nodes without metrics", async () => {
    const service = makeService([
      node({ id: "n1", status: "online", lastMetrics: { timestamp: now(), cpuUtilizationPct: 40, ramUsedBytes: 4_000_000_000, ramTotalBytes: 8_000_000_000, disks: [], network: [], gpus: [], temperatures: {} } }),
      node({ id: "n2", status: "online", lastMetrics: { timestamp: now(), cpuUtilizationPct: 60, ramUsedBytes: 6_000_000_000, ramTotalBytes: 8_000_000_000, disks: [], network: [], gpus: [], temperatures: {} } }),
      node({ id: "n3", status: "offline" }), // no metrics — excluded from averages, still counted
    ]);

    const summary = await service.summary();
    expect(summary.clusterName).toBe("test-cluster");
    expect(summary.nodeCount).toBe(3);
    expect(summary.onlineCount).toBe(2);
    expect(summary.offlineCount).toBe(1);
    expect(summary.avgCpuUtilizationPct).toBe(50);
    expect(summary.avgRamUsedPct).toBe(62.5);
  });

  it("summary reports null averages when no node has metrics yet", async () => {
    const service = makeService([node({ status: "offline" })]);
    const summary = await service.summary();
    expect(summary.avgCpuUtilizationPct).toBeNull();
    expect(summary.avgRamUsedPct).toBeNull();
  });

  it("sends a notification to a specific user, and lists/reads it back", async () => {
    const service = makeService([]);
    const [sent] = await service.sendNotification({ userId: "user_1", kind: "system", title: "Hi", message: "Hello" });
    expect(sent.readAt).toBeUndefined();

    expect(service.listNotifications("user_1")).toHaveLength(1);
    expect(service.listNotifications("user_2")).toHaveLength(0);

    const read = await service.markNotificationRead("user_1", sent.id);
    expect(read?.readAt).toBeDefined();
    expect(service.listNotifications("user_1", true)).toHaveLength(0);

    // Another user can't mark it read.
    const [sent2] = await service.sendNotification({ userId: "user_1", kind: "system", title: "Again", message: "Hi" });
    expect(await service.markNotificationRead("user_2", sent2.id)).toBeUndefined();
  });

  it("broadcasts to every known user when userId is omitted", async () => {
    const service = makeService([], ["user_1", "user_2", "user_3"]);
    const sent = await service.sendNotification({ kind: "system", title: "Maintenance", message: "10pm tonight" });
    expect(sent).toHaveLength(3);
    expect(service.listNotifications("user_2")).toHaveLength(1);
  });

  it("marks all of a user's notifications read at once, leaving other users' untouched", async () => {
    const service = makeService([]);
    await service.sendNotification({ userId: "user_1", kind: "system", title: "A", message: "a" });
    await service.sendNotification({ userId: "user_1", kind: "system", title: "B", message: "b" });
    await service.sendNotification({ userId: "user_2", kind: "system", title: "C", message: "c" });

    const marked = await service.markAllNotificationsRead("user_1");
    expect(marked).toBe(2);
    expect(service.listNotifications("user_1", true)).toHaveLength(0);
    expect(service.listNotifications("user_2", true)).toHaveLength(1);
  });

  it("registers, lists, and unregisters a device, scoped to its owner", async () => {
    const service = makeService([]);
    const device = await service.registerDevice("user_1", "ios", "token-abc", "My iPhone");
    expect(service.listDevices("user_1")).toHaveLength(1);

    expect(await service.unregisterDevice("user_2", device.id)).toBe(false);
    expect(await service.unregisterDevice("user_1", device.id)).toBe(true);
    expect(service.listDevices("user_1")).toHaveLength(0);
  });
});
