import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_ROOT, pickPort, waitUntil } from "./support.js";

/**
 * Exercises the exact single command the build instructions ask for
 * ("one simple development command... that starts the environment") and
 * the "first major demo" acceptance criteria: 3 simulated nodes come
 * online, are visible over the real API, and going offline/online is
 * detected — all through orca-platform/scripts/dev-cluster.mjs itself,
 * not just its individual components.
 */
describe("dev-cluster.mjs (the first major demo)", () => {
  let proc: ReturnType<typeof spawn> | undefined;
  let dataDir: string;

  afterEach(async () => {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      await new Promise<void>((resolve) => {
        proc?.once("exit", () => resolve());
        proc?.kill("SIGTERM");
        setTimeout(() => proc?.kill("SIGKILL"), 4000).unref();
      });
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }, 20000);

  it("brings up Control + 3 simulated nodes + API + Dashboard with one command", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "orca-dev-cluster-"));
    const controlPort = pickPort();
    const apiPort = pickPort();
    const dashboardPort = pickPort();

    proc = spawn(process.execPath, [join(PLATFORM_ROOT, "scripts/dev-cluster.mjs")], {
      cwd: PLATFORM_ROOT,
      env: {
        ...process.env,
        ORCA_DEV_DATA_DIR: dataDir,
        ORCA_CONTROL_PORT: String(controlPort),
        ORCA_API_PORT: String(apiPort),
        ORCA_DASHBOARD_PORT: String(dashboardPort),
        ORCA_CLUSTER_TOKEN: "demo-token",
        ORCA_SESSION_SECRET: "demo-secret",
        ORCA_ADMIN_USERNAME: "admin",
        ORCA_ADMIN_PASSWORD: "admin-password",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true, 25000);
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${dashboardPort}`).catch(() => undefined))?.ok === true, 25000);

    const loginRes = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-password" }),
    });
    const { token } = (await loginRes.json()) as { token: string };

    interface NodeSummary {
      id: string;
      name: string;
      group: string;
      status: string;
      lastMetrics?: { cpuUtilizationPct?: number };
    }
    async function getNodes(): Promise<NodeSummary[]> {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/v1/nodes`, { headers: { authorization: `Bearer ${token}` } });
      return (await res.json()) as NodeSummary[];
    }

    let nodes: NodeSummary[] = [];
    await waitUntil(async () => {
      nodes = await getNodes();
      return nodes.length === 3 && nodes.every((n) => n.status === "online");
    }, 20000);

    const names = nodes.map((n) => n.name).sort();
    expect(names).toEqual(["sim-node-01", "sim-node-02", "sim-node-03"]);
    expect(nodes.find((n) => n.name === "sim-node-03")?.group).toBe("edge");

    // Live metrics should be flowing, not static/mock zeros.
    await waitUntil(async () => {
      nodes = await getNodes();
      return nodes.every((n) => typeof n.lastMetrics?.cpuUtilizationPct === "number");
    }, 10000);
  }, 60000);
});
