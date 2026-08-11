import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pickPort, spawnService, waitUntil, type SpawnedProcess } from "./support.js";

const TOKEN = "e2e-cluster-token";

/**
 * True end-to-end test: spawns real `orca-control` and `orca-agent`
 * processes (not in-process test doubles) and drives them over the network,
 * the same way they'd run in the multi-node dev cluster.
 */
describe("control + agent end-to-end", () => {
  let controlProc: SpawnedProcess | undefined;
  let agentProc: SpawnedProcess | undefined;
  let dirs: string[] = [];

  afterEach(async () => {
    await agentProc?.stop();
    await controlProc?.stop();
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    dirs = [];
    controlProc = undefined;
    agentProc = undefined;
  });

  it("registers a simulated agent, reports live metrics, runs a command, and detects offline on shutdown", async () => {
    const controlPort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-e2e-control-"));
    const agentDir = await mkdtemp(join(tmpdir(), "orca-e2e-agent-"));
    dirs = [controlDir, agentDir];
    const baseUrl = `http://127.0.0.1:${controlPort}/api/v1`;

    controlProc = spawnService("control/src/index.ts", {
      ORCA_CONTROL_PORT: String(controlPort),
      ORCA_CLUSTER_TOKEN: TOKEN,
      ORCA_DATA_DIR: controlDir,
      ORCA_LOG_PRETTY: "0",
    });

    await waitUntil(async () => {
      const res = await fetch(`${baseUrl}/health`).catch(() => undefined);
      return res?.ok === true;
    });

    agentProc = spawnService("agent/src/index.ts", {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${controlPort}/mesh`,
      ORCA_CLUSTER_TOKEN: TOKEN,
      ORCA_NODE_NAME: "e2e-sim-node",
      ORCA_SIMULATED: "1",
      ORCA_DATA_DIR: agentDir,
      ORCA_HEARTBEAT_INTERVAL_MS: "300",
      ORCA_LOG_PRETTY: "0",
    });

    let nodeId = "";
    await waitUntil(async () => {
      const res = await fetch(`${baseUrl}/nodes`);
      const nodes = (await res.json()) as Array<{ id: string; name: string; status: string }>;
      const node = nodes.find((n) => n.name === "e2e-sim-node");
      if (node?.status === "online") {
        nodeId = node.id;
        return true;
      }
      return false;
    });
    expect(nodeId).not.toBe("");

    // Live metrics should show up within a couple of heartbeats.
    await waitUntil(async () => {
      const res = await fetch(`${baseUrl}/nodes/${nodeId}/metrics`);
      const metrics = (await res.json()) as { cpuUtilizationPct?: number } | null;
      return typeof metrics?.cpuUtilizationPct === "number";
    });

    // Command round-trip against the real agent process.
    const createRes = await fetch(`${baseUrl}/nodes/${nodeId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ping", payload: {} }),
    });
    expect(createRes.status).toBe(202);
    const command = (await createRes.json()) as { id: string };

    await waitUntil(async () => {
      const res = await fetch(`${baseUrl}/commands/${command.id}`);
      const cmd = (await res.json()) as { status: string; result?: { pong?: boolean } };
      return cmd.status === "succeeded" && cmd.result?.pong === true;
    });

    // Killing the agent process should be detected as the node going offline.
    await agentProc.stop();
    await waitUntil(async () => {
      const res = await fetch(`${baseUrl}/nodes/${nodeId}`);
      const node = (await res.json()) as { status: string };
      return node.status === "offline";
    }, 15000);
  }, 45000);
});
