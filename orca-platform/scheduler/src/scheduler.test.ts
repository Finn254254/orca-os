import { describe, expect, it } from "vitest";
import type { JobSpec, NodeRecord } from "@orca/shared";
import { selectNode } from "./scheduler.js";

function node(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: "node_1",
    name: "node-1",
    group: "default",
    status: "online",
    services: [],
    registeredAt: new Date().toISOString(),
    labels: {},
    capabilities: { cpuCores: 8, ramTotalBytes: 16 * 1024 ** 3, gpus: [], tags: [] },
    ...overrides,
  };
}

function spec(overrides: Partial<JobSpec> = {}): JobSpec {
  return { type: "shell", workload: {}, resources: {}, requiredCapabilities: [], ...overrides };
}

describe("selectNode", () => {
  it("fails with no nodes registered", () => {
    const result = selectNode([], spec());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toMatch(/no nodes registered/);
  });

  it("excludes offline nodes", () => {
    const nodes = [node({ id: "a", status: "offline" }), node({ id: "b", status: "online" })];
    const result = selectNode(nodes, spec());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("b");
  });

  it("reports why every node was rejected when none qualify", () => {
    const nodes = [node({ id: "a", status: "offline" }), node({ id: "b", status: "degraded" })];
    const result = selectNode(nodes, spec());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.rejected).toHaveLength(2);
      expect(result.failure.rejected.find((r) => r.nodeId === "a")?.reason).toMatch(/offline/);
    }
  });

  it("picks the node with more free CPU and RAM headroom", () => {
    const busy = node({
      id: "busy",
      lastMetrics: { timestamp: "t", cpuUtilizationPct: 90, ramUsedBytes: 15 * 1024 ** 3, ramTotalBytes: 16 * 1024 ** 3, disks: [], network: [], gpus: [], temperatures: {} },
    });
    const idle = node({
      id: "idle",
      lastMetrics: { timestamp: "t", cpuUtilizationPct: 5, ramUsedBytes: 1 * 1024 ** 3, ramTotalBytes: 16 * 1024 ** 3, disks: [], network: [], gpus: [], temperatures: {} },
    });
    const result = selectNode([busy, idle], spec());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("idle");
  });

  it("penalizes an overheating node even if otherwise idle", () => {
    const hot = node({
      id: "hot",
      lastMetrics: { timestamp: "t", cpuUtilizationPct: 5, ramUsedBytes: 1 * 1024 ** 3, ramTotalBytes: 16 * 1024 ** 3, disks: [], network: [], gpus: [], temperatures: { cpu: 95 } },
    });
    const warm = node({
      id: "warm",
      lastMetrics: { timestamp: "t", cpuUtilizationPct: 20, ramUsedBytes: 4 * 1024 ** 3, ramTotalBytes: 16 * 1024 ** 3, disks: [], network: [], gpus: [], temperatures: { cpu: 50 } },
    });
    const result = selectNode([hot, warm], spec());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("warm");
  });

  it("respects a pinned target node", () => {
    const nodes = [node({ id: "a" }), node({ id: "b" })];
    const result = selectNode(nodes, spec({ targetNodeId: "b" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("b");
  });

  it("respects a target group", () => {
    const nodes = [node({ id: "a", group: "default" }), node({ id: "b", group: "edge" })];
    const result = selectNode(nodes, spec({ targetGroup: "edge" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("b");
  });

  it("filters on required capability tags", () => {
    const nodes = [
      node({ id: "a", capabilities: { cpuCores: 8, gpus: [], tags: [] } }),
      node({ id: "b", capabilities: { cpuCores: 8, gpus: [], tags: ["fast-storage"] } }),
    ];
    const result = selectNode(nodes, spec({ requiredCapabilities: ["fast-storage"] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("b");
  });

  it("filters on CPU core and GPU requirements", () => {
    const nodes = [
      node({ id: "small", capabilities: { cpuCores: 2, gpus: [], tags: [] } }),
      node({ id: "big-no-gpu", capabilities: { cpuCores: 32, gpus: [], tags: [] } }),
      node({ id: "big-gpu", capabilities: { cpuCores: 32, gpus: [{ index: 0, vendor: "x", model: "y", vramTotalBytes: 8e9 }], tags: [] } }),
    ];
    const result = selectNode(nodes, spec({ resources: { cpuCores: 16, gpu: true } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.nodeId).toBe("big-gpu");
  });

  it("rejects nodes without enough free RAM", () => {
    const nodes = [
      node({
        id: "tight",
        lastMetrics: { timestamp: "t", ramUsedBytes: 15 * 1024 ** 3, ramTotalBytes: 16 * 1024 ** 3, disks: [], network: [], gpus: [], temperatures: {} },
      }),
    ];
    const result = selectNode(nodes, spec({ resources: { ramBytes: 4 * 1024 ** 3 } }));
    expect(result.ok).toBe(false);
  });
});
