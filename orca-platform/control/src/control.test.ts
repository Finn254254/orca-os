import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeshClient } from "@orca/mesh";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createControlServer, type ControlServerHandle } from "./server.js";

const TOKEN = "control-test-token";

function waitFor<T>(emitter: { once: (event: string, cb: (...a: unknown[]) => void) => void }, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (payload: unknown) => resolve(payload as T)));
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitUntil timed out");
}

describe("orca-control", () => {
  let dir: string;
  let handle: ControlServerHandle;
  let baseUrl: string;
  let wsUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-control-"));
    handle = await createControlServer({
      port: 0,
      dataDir: dir,
      clusterToken: TOKEN,
      clusterName: "test-cluster",
    });
    const address = handle.httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/mesh`;
  });

  afterEach(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("reports empty cluster state before any node connects", async () => {
    const res = await request(baseUrl).get("/api/v1/nodes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("registers a node, tracks heartbeats, and exposes it over HTTP", async () => {
    const client = new MeshClient({
      url: wsUrl,
      token: TOKEN,
      nodeId: "node_a",
      name: "sim-node-a",
      group: "sim",
      capabilities: { cpuCores: 4, ramTotalBytes: 8_000_000_000, gpus: [], tags: [] },
    });
    client.start();
    await waitFor(client, "ack");

    await waitUntil(async () => {
      const res = await request(baseUrl).get("/api/v1/nodes/node_a");
      return res.status === 200 && res.body.status === "online";
    });

    client.sendHeartbeat({
      timestamp: new Date().toISOString(),
      cpuUtilizationPct: 42,
      ramUsedBytes: 1000,
      ramTotalBytes: 8_000_000_000,
      disks: [],
      network: [],
      gpus: [],
      temperatures: {},
    });

    await waitUntil(async () => {
      const res = await request(baseUrl).get("/api/v1/nodes/node_a/metrics");
      return res.body?.cpuUtilizationPct === 42;
    });

    const list = await request(baseUrl).get("/api/v1/nodes");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("sim-node-a");
    expect(list.body[0].connected).toBe(true);

    client.stop();
  });

  it("marks a node offline when it disconnects", async () => {
    const client = new MeshClient({ url: wsUrl, token: TOKEN, nodeId: "node_b", name: "sim-node-b" });
    client.start();
    await waitFor(client, "ack");
    await waitUntil(async () => (await request(baseUrl).get("/api/v1/nodes/node_b")).body.status === "online");

    client.stop();

    await waitUntil(async () => (await request(baseUrl).get("/api/v1/nodes/node_b")).body.status === "offline");
  });

  it("delivers a command to a connected node and records its result", async () => {
    const received: string[] = [];
    const client = new MeshClient({ url: wsUrl, token: TOKEN, nodeId: "node_c", name: "sim-node-c" });
    client.on("command", (command) => {
      received.push(command.id);
      client.sendCommandResult(command.id, "succeeded", { pong: true });
    });
    client.start();
    await waitFor(client, "ack");
    await waitUntil(async () => (await request(baseUrl).get("/api/v1/nodes/node_c")).body.status === "online");

    const createRes = await request(baseUrl).post("/api/v1/nodes/node_c/commands").send({ type: "ping", payload: {} });
    expect(createRes.status).toBe(202);
    const commandId = createRes.body.id;

    await waitUntil(async () => (await request(baseUrl).get(`/api/v1/commands/${commandId}`)).body.status === "succeeded");
    expect(received).toContain(commandId);

    client.stop();
  });

  it("rejects commands for unknown nodes", async () => {
    const res = await request(baseUrl).post("/api/v1/nodes/nope/commands").send({ type: "ping" });
    expect(res.status).toBe(404);
  });

  it("persists cluster state across restarts", async () => {
    const client = new MeshClient({ url: wsUrl, token: TOKEN, nodeId: "node_d", name: "sim-node-d" });
    client.start();
    await waitFor(client, "ack");
    await waitUntil(async () => (await request(baseUrl).get("/api/v1/nodes/node_d")).status === 200);
    await handle.store.flush();
    client.stop();
    await handle.close();

    const restarted = await createControlServer({ port: 0, dataDir: dir, clusterToken: TOKEN, clusterName: "test-cluster" });
    try {
      const address = restarted.httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const res = await request(`http://127.0.0.1:${port}`).get("/api/v1/nodes/node_d");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("sim-node-d");
    } finally {
      await restarted.close();
    }
    // afterEach still calls handle.close(); make it a no-op by re-pointing to a fresh, already-closed-safe handle.
    handle = { ...handle, close: async () => undefined };
  });
});
