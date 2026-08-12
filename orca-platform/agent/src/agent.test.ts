import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeshServer } from "@orca/mesh";
import { createLogger } from "@orca/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrcaAgent } from "./agent.js";
import type { AgentConfig } from "./config.js";
import { SimulatedMetricsProvider } from "./metrics/simulated.js";

const TOKEN = "agent-test-token";
const silentLogger = createLogger("test");
silentLogger.level = "silent";

function waitFor<T>(emitter: { once: (event: string, cb: (...a: unknown[]) => void) => void }, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (payload: unknown) => resolve(payload as T)));
}

describe("OrcaAgent", () => {
  let httpServer: Server;
  let meshServer: MeshServer;
  let dir: string;
  let agent: OrcaAgent | undefined;
  let wsUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-agent-"));
    httpServer = createServer();
    meshServer = new MeshServer({
      httpServer,
      token: TOKEN,
      getClusterConfig: () => ({
        clusterName: "test",
        groups: [{ name: "default" }],
        heartbeatIntervalMs: 50,
        heartbeatTimeoutMs: 500,
        settings: {},
      }),
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as { port: number }).port;
    wsUrl = `ws://127.0.0.1:${port}/mesh`;
  });

  afterEach(async () => {
    agent?.stop();
    await meshServer.close();
    httpServer.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return {
      controlUrl: wsUrl,
      clusterToken: TOKEN,
      nodeName: "test-node",
      nodeGroup: "sim",
      dataDir: dir,
      simulated: true,
      heartbeatIntervalMs: 50,
      allowPowerCommands: false,
      allowShellCommands: false,
      allowComputeJobs: true,
      ...overrides,
    };
  }

  it("registers with Control and sends heartbeats with metrics", async () => {
    const helloPromise = waitFor<{ nodeId: string; capabilities?: { cpuCores?: number } }>(meshServer, "hello");
    agent = new OrcaAgent({
      config: makeConfig(),
      nodeId: "node_agent_1",
      metrics: new SimulatedMetricsProvider(),
      logger: silentLogger,
    });
    await agent.start();

    const hello = await helloPromise;
    expect(hello.nodeId).toBe("node_agent_1");
    expect(hello.capabilities?.cpuCores).toBeGreaterThan(0);

    const heartbeat = await waitFor<{ nodeId: string; metrics?: { cpuUtilizationPct?: number } }>(meshServer, "heartbeat");
    expect(heartbeat.nodeId).toBe("node_agent_1");
    expect(heartbeat.metrics?.cpuUtilizationPct).toBeGreaterThanOrEqual(0);
  });

  it("responds to a ping command", async () => {
    agent = new OrcaAgent({
      config: makeConfig(),
      nodeId: "node_agent_2",
      metrics: new SimulatedMetricsProvider(),
      logger: silentLogger,
    });
    await agent.start();
    await waitFor(meshServer, "hello");

    const resultPromise = waitFor<{ commandId: string; status: string; result?: Record<string, unknown> }>(
      meshServer,
      "commandResult",
    );
    meshServer.sendCommand({
      id: "cmd_ping",
      nodeId: "node_agent_2",
      type: "ping",
      payload: {},
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    const result = await resultPromise;
    expect(result.status).toBe("succeeded");
    expect(result.result?.pong).toBe(true);
  });

  it("refuses shell commands unless explicitly enabled", async () => {
    agent = new OrcaAgent({
      config: makeConfig({ allowShellCommands: false }),
      nodeId: "node_agent_3",
      metrics: new SimulatedMetricsProvider(),
      logger: silentLogger,
    });
    await agent.start();
    await waitFor(meshServer, "hello");

    const resultPromise = waitFor<{ status: string; error?: string }>(meshServer, "commandResult");
    meshServer.sendCommand({
      id: "cmd_shell",
      nodeId: "node_agent_3",
      type: "shell",
      payload: { command: ["echo", "hi"] },
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    const result = await resultPromise;
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/disabled/);
  });

  it("simulates power commands without touching the host when config.simulated is true", async () => {
    agent = new OrcaAgent({
      config: makeConfig({ simulated: true }),
      nodeId: "node_agent_4",
      metrics: new SimulatedMetricsProvider(),
      logger: silentLogger,
    });
    await agent.start();
    await waitFor(meshServer, "hello");

    const resultPromise = waitFor<{ status: string; result?: Record<string, unknown> }>(meshServer, "commandResult");
    meshServer.sendCommand({
      id: "cmd_power",
      nodeId: "node_agent_4",
      type: "power",
      payload: { action: "reboot" },
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    const result = await resultPromise;
    expect(result.status).toBe("succeeded");
    expect(result.result?.simulated).toBe(true);
  });

  it("simulates run_job commands on simulated nodes instead of executing on the host", async () => {
    agent = new OrcaAgent({
      config: makeConfig({ simulated: true }),
      nodeId: "node_agent_5",
      metrics: new SimulatedMetricsProvider(),
      logger: silentLogger,
    });
    await agent.start();
    await waitFor(meshServer, "hello");

    const resultPromise = waitFor<{ status: string; result?: Record<string, unknown> }>(meshServer, "commandResult");
    meshServer.sendCommand({
      id: "cmd_job",
      nodeId: "node_agent_5",
      type: "run_job",
      payload: { command: ["echo", "hello"] },
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    const result = await resultPromise;
    expect(result.status).toBe("succeeded");
    expect(result.result?.simulated).toBe(true);
    expect(String(result.result?.stdout)).toContain("echo hello");
  });

  it("fails run_job when payload.forceFail is set (for testing failure paths)", async () => {
    agent = new OrcaAgent({
      config: makeConfig({ simulated: true }),
      nodeId: "node_agent_6",
      metrics: new SimulatedMetricsProvider(),
      logger: silentLogger,
    });
    await agent.start();
    await waitFor(meshServer, "hello");

    const resultPromise = waitFor<{ status: string; error?: string }>(meshServer, "commandResult");
    meshServer.sendCommand({
      id: "cmd_job_fail",
      nodeId: "node_agent_6",
      type: "run_job",
      payload: { command: ["false"], forceFail: true },
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    const result = await resultPromise;
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/simulated job failure/);
  });
});
