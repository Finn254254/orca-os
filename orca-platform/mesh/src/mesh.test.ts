import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshClient } from "./client.js";
import { MeshServer } from "./server.js";

const TOKEN = "test-token";

function waitFor<T>(emitter: { once: (event: string, cb: (...a: unknown[]) => void) => void }, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (payload: unknown) => resolve(payload as T)));
}

describe("mesh protocol", () => {
  let httpServer: Server;
  let meshServer: MeshServer;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    meshServer = new MeshServer({ httpServer, token: TOKEN, getClusterConfig: () => ({
      clusterName: "test",
      groups: [{ name: "default" }],
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 500,
      settings: {},
    }) });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    await meshServer.close();
    httpServer.close();
  });

  it("registers a node via hello and acks with cluster config", async () => {
    const client = new MeshClient({ url: `ws://127.0.0.1:${port}/mesh`, token: TOKEN, nodeId: "node_1", name: "node-1" });
    const helloPromise = waitFor<{ nodeId: string; name: string }>(meshServer, "hello");
    const ackPromise = waitFor<import("@orca/shared").ClusterConfig>(client, "ack");
    client.start();

    const hello = await helloPromise;
    expect(hello.nodeId).toBe("node_1");

    const ack = await ackPromise;
    expect(ack?.clusterName).toBe("test");
    expect(client.isConnected()).toBe(true);

    client.stop();
  });

  it("rejects a bad token", async () => {
    const client = new MeshClient({ url: `ws://127.0.0.1:${port}/mesh`, token: "wrong", nodeId: "node_bad", name: "bad" });
    const errorSpy = vi.fn();
    client.on("close", errorSpy);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.isConnected()).toBe(false);
    client.stop();
  });

  it("delivers heartbeats and commands round-trip", async () => {
    const client = new MeshClient({ url: `ws://127.0.0.1:${port}/mesh`, token: TOKEN, nodeId: "node_2", name: "node-2" });
    client.start();
    await waitFor(meshServer, "hello");

    const heartbeatPromise = waitFor<{ nodeId: string }>(meshServer, "heartbeat");
    client.sendHeartbeat({
      timestamp: new Date().toISOString(),
      cpuUtilizationPct: 12,
      disks: [],
      network: [],
      gpus: [],
      temperatures: {},
    });
    const heartbeat = await heartbeatPromise;
    expect(heartbeat.nodeId).toBe("node_2");

    const commandPromise = waitFor<import("@orca/shared").CommandRecord>(client, "command");
    const sent = meshServer.sendCommand({
      id: "cmd_1",
      nodeId: "node_2",
      type: "ping",
      payload: {},
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    expect(sent).toBe(true);
    const command = await commandPromise;
    expect(command.id).toBe("cmd_1");

    const resultPromise = waitFor<{ commandId: string; status: string }>(meshServer, "commandResult");
    client.sendCommandResult("cmd_1", "succeeded", { pong: true });
    const result = await resultPromise;
    expect(result.commandId).toBe("cmd_1");
    expect(result.status).toBe("succeeded");

    client.stop();
  });

  it("emits disconnect when a node goes away", async () => {
    const client = new MeshClient({ url: `ws://127.0.0.1:${port}/mesh`, token: TOKEN, nodeId: "node_3", name: "node-3" });
    client.start();
    await waitFor(meshServer, "hello");
    const disconnectPromise = waitFor<{ nodeId: string }>(meshServer, "disconnect");
    client.stop();
    const disconnect = await disconnectPromise;
    expect(disconnect.nodeId).toBe("node_3");
  });
});
