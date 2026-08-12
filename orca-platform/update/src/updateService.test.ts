import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateId, now, type CommandRecord, type CommandType, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { UpdateService } from "./updateService.js";
import { UpdateStore } from "./store.js";

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

  completeCommand(id: string, status: "succeeded" | "failed") {
    const command = this.commands.get(id);
    if (command) this.commands.set(id, { ...command, status });
  }

  commandsForNode(nodeId: string): CommandRecord[] {
    return [...this.commands.values()].filter((c) => c.nodeId === nodeId);
  }
}

function node(id: string): NodeRecord {
  return { id, name: id, group: "default", status: "online", services: [], registeredAt: now(), labels: {} };
}

describe("UpdateService", () => {
  let dir: string;
  let store: UpdateStore;
  let control: FakeControlPort;
  let service: UpdateService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-update-"));
    store = new UpdateStore(dir);
    await store.init();
    control = new FakeControlPort();
    service = new UpdateService({ store, control, signingKey: "test-signing-key" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("publishes a signed manifest that verifies", async () => {
    const manifest = await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    expect(manifest.signature).toBeTruthy();
    expect(service.verifyManifest(manifest)).toBe(true);
  });

  it("refuses to start a rollout for an unpublished version", async () => {
    await expect(service.startRollout({ version: "9.9.9", strategy: "all-at-once" })).rejects.toThrow(/no published manifest/);
  });

  it("dispatches to all target nodes at once for all-at-once strategy", async () => {
    control.nodes = [node("n1"), node("n2"), node("n3")];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", strategy: "all-at-once" });
    expect(rollout.state).toBe("in-progress");
    expect(Object.keys(rollout.perNodeStatus)).toHaveLength(3);
    expect(control.commandsForNode("n1")).toHaveLength(1);
  });

  it("completes a rollout once every node succeeds", async () => {
    control.nodes = [node("n1"), node("n2")];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", strategy: "all-at-once" });
    for (const cmd of control.commands.values()) control.completeCommand(cmd.id, "succeeded");

    await service.pollOnce();
    const updated = service.getRollout(rollout.id);
    expect(updated?.state).toBe("completed");
    expect(Object.values(updated!.perNodeStatus).every((s) => s.state === "succeeded")).toBe(true);
  });

  it("marks a rollout failed if any node fails", async () => {
    control.nodes = [node("n1"), node("n2")];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", strategy: "all-at-once" });
    const commands = [...control.commands.values()];
    control.completeCommand(commands[0].id, "succeeded");
    control.completeCommand(commands[1].id, "failed");

    await service.pollOnce();
    expect(service.getRollout(rollout.id)?.state).toBe("failed");
  });

  it("only dispatches the first stage for a staged rollout, then continues on demand", async () => {
    control.nodes = [node("n1"), node("n2"), node("n3"), node("n4")];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", strategy: "staged", stagePct: 50 });
    expect(Object.keys(rollout.perNodeStatus)).toHaveLength(2);

    for (const cmd of control.commands.values()) control.completeCommand(cmd.id, "succeeded");
    await service.pollOnce();

    const continued = await service.continueRollout(rollout.id);
    expect(Object.keys(continued!.perNodeStatus)).toHaveLength(4);
  });

  it("refuses to continue a staged rollout while a batch is still applying", async () => {
    control.nodes = [node("n1"), node("n2")];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", strategy: "staged", stagePct: 50 });
    await expect(service.continueRollout(rollout.id)).rejects.toThrow(/still in progress/);
  });

  it("rolls back nodes that successfully applied", async () => {
    control.nodes = [node("n1")];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", strategy: "all-at-once" });
    for (const cmd of control.commands.values()) control.completeCommand(cmd.id, "succeeded");
    await service.pollOnce();

    const rolledBack = await service.rollback(rollout.id);
    expect(rolledBack?.state).toBe("rolled-back");
    expect(rolledBack?.perNodeStatus.n1.state).toBe("rolled-back");
    expect(control.commandsForNode("n1").some((c) => c.type === "rollback_update")).toBe(true);
  });

  it("scopes a rollout to a target group", async () => {
    control.nodes = [node("n1"), { ...node("n2"), group: "edge" }];
    await service.publishManifest({ version: "1.0.0", artifactUrl: "https://x/img", checksum: "abc" });
    const rollout = await service.startRollout({ version: "1.0.0", targetGroup: "edge", strategy: "all-at-once" });
    expect(rollout.targetNodeIds).toEqual(["n2"]);
  });
});
