import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateId, now, type AppManifest, type CommandRecord, type CommandType, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { DeployService } from "./deployService.js";
import { AppStore } from "./store.js";

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

  lastCommandOfType(type: CommandType): CommandRecord | undefined {
    return [...this.commands.values()].reverse().find((c) => c.type === type);
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

function manifest(overrides: Partial<AppManifest> = {}): AppManifest {
  return {
    name: "web",
    version: "1.0",
    image: "nginx",
    ports: [],
    volumes: [],
    env: {},
    resources: {},
    targetCapabilities: [],
    restartPolicy: "on-failure",
    ...overrides,
  };
}

describe("DeployService", () => {
  let dir: string;
  let store: AppStore;
  let control: FakeControlPort;
  let service: DeployService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-deploy-"));
    store = new AppStore(dir);
    await store.init();
    control = new FakeControlPort();
    service = new DeployService({ store, control });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("fails immediately when no node is eligible", async () => {
    const deployment = await service.deployApp(manifest());
    expect(deployment.state).toBe("failed");
    expect(deployment.error).toMatch(/no nodes registered/);
  });

  it("schedules and dispatches a deploy_app command", async () => {
    control.nodes = [onlineNode()];
    const deployment = await service.deployApp(manifest());
    expect(deployment.state).toBe("deploying");
    expect(deployment.assignedNodeId).toBe("node_1");
    const command = control.lastCommandOfType("deploy_app");
    expect(command?.payload.manifest).toMatchObject({ name: "web", image: "nginx" });
  });

  it("marks a deployment running with its container id once dispatched command succeeds", async () => {
    control.nodes = [onlineNode()];
    const deployment = await service.deployApp(manifest());
    const command = control.lastCommandOfType("deploy_app")!;
    control.completeCommand(command.id, "succeeded", { containerId: "abc123" });

    await service.pollOnce();
    const updated = service.getDeployment(deployment.id);
    expect(updated?.state).toBe("running");
    expect(updated?.containerId).toBe("abc123");
  });

  it("marks a deployment failed when its command fails", async () => {
    control.nodes = [onlineNode()];
    const deployment = await service.deployApp(manifest());
    const command = control.lastCommandOfType("deploy_app")!;
    control.completeCommand(command.id, "failed", undefined, "image pull failed");

    await service.pollOnce();
    expect(service.getDeployment(deployment.id)?.state).toBe("failed");
    expect(service.getDeployment(deployment.id)?.error).toBe("image pull failed");
  });

  it("removes a running app by dispatching remove_app and marking it stopped", async () => {
    control.nodes = [onlineNode()];
    const deployment = await service.deployApp(manifest());
    const deployCommand = control.lastCommandOfType("deploy_app")!;
    control.completeCommand(deployCommand.id, "succeeded", { containerId: "abc123" });
    await service.pollOnce();

    const removed = await service.removeApp(deployment.id);
    expect(removed?.state).toBe("stopped");
    const removeCommand = control.lastCommandOfType("remove_app");
    expect(removeCommand?.payload.name).toBe("web");
  });

  it("returns undefined removing an unknown deployment", async () => {
    expect(await service.removeApp("app_nope")).toBeUndefined();
  });

  it("respects target capabilities when scheduling", async () => {
    control.nodes = [
      onlineNode({ id: "no-gpu", capabilities: { cpuCores: 8, gpus: [], tags: [] } }),
      onlineNode({ id: "gpu-node", capabilities: { cpuCores: 8, gpus: [], tags: ["gpu-accelerated"] } }),
    ];
    const deployment = await service.deployApp(manifest({ targetCapabilities: ["gpu-accelerated"] }));
    expect(deployment.assignedNodeId).toBe("gpu-node");
  });
});
