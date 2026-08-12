import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateId, now, type CommandRecord, type CommandType, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { JobService } from "./jobService.js";
import { JobStore } from "./store.js";

class FakeControlPort implements ControlPort {
  nodes: NodeRecord[] = [];
  commands = new Map<string, CommandRecord>();

  async listNodes(): Promise<NodeRecord[]> {
    return this.nodes;
  }

  async createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>): Promise<CommandRecord> {
    const command: CommandRecord = { id: generateId("cmd"), nodeId, type, payload, status: "sent", createdAt: now() };
    this.commands.set(command.id, command);
    return command;
  }

  async getCommand(id: string): Promise<CommandRecord> {
    const command = this.commands.get(id);
    if (!command) throw new Error("command not found");
    return command;
  }

  completeCommand(id: string, status: "succeeded" | "failed", result?: Record<string, unknown>, error?: string) {
    const command = this.commands.get(id);
    if (command) this.commands.set(id, { ...command, status, result, error });
  }
}

function onlineNode(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: "node_1",
    name: "node-1",
    group: "default",
    status: "online",
    services: [],
    registeredAt: now(),
    labels: {},
    capabilities: { cpuCores: 8, ramTotalBytes: 16 * 1024 ** 3, gpus: [], tags: [] },
    ...overrides,
  };
}

describe("JobService", () => {
  let dir: string;
  let store: JobStore;
  let control: FakeControlPort;
  let service: JobService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-compute-"));
    store = new JobStore(dir);
    await store.init();
    control = new FakeControlPort();
    service = new JobService({ store, control });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("fails immediately when no node is eligible", async () => {
    const job = await service.submitJob({ type: "shell", command: ["echo", "hi"], workload: {}, resources: {}, requiredCapabilities: [] });
    expect(job.state).toBe("failed");
    expect(job.failureReason).toMatch(/no nodes registered/);
  });

  it("schedules and dispatches to an eligible node", async () => {
    control.nodes = [onlineNode()];
    const job = await service.submitJob({ type: "shell", command: ["echo", "hi"], workload: {}, resources: {}, requiredCapabilities: [] });
    expect(job.state).toBe("running");
    expect(job.assignedNodeId).toBe("node_1");
    expect(job.schedulingReason).toMatch(/selected node-1/);
    expect(control.commands.size).toBe(1);
  });

  it("marks a job succeeded once its command completes", async () => {
    control.nodes = [onlineNode()];
    const job = await service.submitJob({ type: "shell", command: ["echo", "hi"], workload: {}, resources: {}, requiredCapabilities: [] });
    const [commandId] = [...control.commands.keys()];
    control.completeCommand(commandId, "succeeded", { stdout: "hi\n" });

    await service.pollOnce();
    const updated = service.getJob(job.id);
    expect(updated?.state).toBe("succeeded");
    expect(updated?.progressPct).toBe(100);
    expect(updated?.result?.stdout).toBe("hi\n");
  });

  it("marks a job failed when its command fails", async () => {
    control.nodes = [onlineNode()];
    const job = await service.submitJob({ type: "shell", command: ["false"], workload: {}, resources: {}, requiredCapabilities: [] });
    const [commandId] = [...control.commands.keys()];
    control.completeCommand(commandId, "failed", undefined, "exit code 1");

    await service.pollOnce();
    const updated = service.getJob(job.id);
    expect(updated?.state).toBe("failed");
    expect(updated?.failureReason).toBe("exit code 1");
  });

  it("leaves an in-progress job alone until its command resolves", async () => {
    control.nodes = [onlineNode()];
    const job = await service.submitJob({ type: "shell", command: ["sleep", "1"], workload: {}, resources: {}, requiredCapabilities: [] });
    await service.pollOnce();
    expect(service.getJob(job.id)?.state).toBe("running");
  });

  it("cancels a queued/running job", async () => {
    control.nodes = [onlineNode()];
    const job = await service.submitJob({ type: "shell", command: ["sleep", "10"], workload: {}, resources: {}, requiredCapabilities: [] });
    const cancelled = await service.cancelJob(job.id);
    expect(cancelled?.state).toBe("cancelled");

    // A late-arriving completion must not resurrect the cancelled job.
    const [commandId] = [...control.commands.keys()];
    control.completeCommand(commandId, "succeeded", { stdout: "too late" });
    await service.pollOnce();
    expect(service.getJob(job.id)?.state).toBe("cancelled");
  });

  it("returns undefined when cancelling an unknown job", async () => {
    expect(await service.cancelJob("job_nope")).toBeUndefined();
  });
});
