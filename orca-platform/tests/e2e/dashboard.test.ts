import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_ROOT, pickPort, spawnService, waitUntil, type SpawnedProcess } from "./support.js";

const CLUSTER_TOKEN = "dash-e2e-cluster-token";
const SESSION_SECRET = "dash-e2e-session-secret";
const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

function spawnVite(port: number, proxyTarget: string): SpawnedProcess {
  const viteBin = join(PLATFORM_ROOT, "node_modules", ".bin", "vite");
  const proc = spawn(viteBin, ["--port", String(port), "--strictPort"], {
    cwd: join(PLATFORM_ROOT, "dashboard"),
    env: { ...process.env, ORCA_API_PROXY_TARGET: proxyTarget },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs: string[] = [];
  proc.stdout.on("data", (d) => logs.push(String(d)));
  proc.stderr.on("data", (d) => logs.push(String(d)));
  return {
    proc,
    logs,
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          resolve();
          return;
        }
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        }, 3000).unref();
      }),
  };
}

describe("Orca Dashboard (browser)", () => {
  let controlProc: SpawnedProcess | undefined;
  let apiProc: SpawnedProcess | undefined;
  let agentProc: SpawnedProcess | undefined;
  let viteProc: SpawnedProcess | undefined;
  let browser: Browser | undefined;
  let dirs: string[] = [];

  afterEach(async () => {
    await browser?.close();
    await Promise.all([viteProc?.stop(), agentProc?.stop(), apiProc?.stop(), controlProc?.stop()]);
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    dirs = [];
  }, 15000);

  it("logs in and shows a live, real node in the table — not mock data", async () => {
    const controlPort = pickPort();
    const apiPort = pickPort();
    const vitePort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-dash-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-dash-api-"));
    const agentDir = await mkdtemp(join(tmpdir(), "orca-dash-agent-"));
    dirs = [controlDir, apiDir, agentDir];

    controlProc = spawnService("control/src/index.ts", {
      ORCA_CONTROL_PORT: String(controlPort),
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_DATA_DIR: controlDir,
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${controlPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    apiProc = spawnService("api/src/index.ts", {
      ORCA_API_PORT: String(apiPort),
      ORCA_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
      ORCA_SESSION_SECRET: SESSION_SECRET,
      ORCA_ADMIN_USERNAME: "admin",
      ORCA_ADMIN_PASSWORD: "admin-password",
      ORCA_DATA_DIR: apiDir,
      ORCA_API_POLL_INTERVAL_MS: "200",
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    agentProc = spawnService("agent/src/index.ts", {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${controlPort}/mesh`,
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_NODE_NAME: "dashboard-e2e-node",
      ORCA_SIMULATED: "1",
      ORCA_DATA_DIR: agentDir,
      ORCA_HEARTBEAT_INTERVAL_MS: "300",
      ORCA_LOG_PRETTY: "0",
    });

    viteProc = spawnVite(vitePort, `http://127.0.0.1:${apiPort}`);
    const dashboardUrl = `http://127.0.0.1:${vitePort}`;
    await waitUntil(async () => (await fetch(dashboardUrl).catch(() => undefined))?.ok === true, 20000);

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.goto(`${dashboardUrl}/login`);
    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(`${dashboardUrl}/`);
    await expect.poll(() => page.getByText("dashboard-e2e-node").isVisible(), { timeout: 15000 }).toBe(true);

    // The status pill should reflect the real node's real status, not a placeholder.
    const statusText = await page.locator("tr", { hasText: "dashboard-e2e-node" }).locator(".status-pill").textContent();
    expect(statusText?.trim()).toBe("online");

    // Live CPU metric from the simulated agent should render as a non-dash percentage.
    await expect
      .poll(async () => {
        const row = page.locator("tr", { hasText: "dashboard-e2e-node" });
        const cpuCell = await row.locator("td").nth(3).textContent();
        return cpuCell?.includes("%") ?? false;
      }, { timeout: 15000 })
      .toBe(true);

    // Click into node detail and confirm real capabilities render (not mock data).
    await page.getByText("dashboard-e2e-node").click();
    await page.waitForURL(/\/nodes\/node_/);
    await expect.poll(() => page.getByText("Simulated Orca CPU").isVisible(), { timeout: 10000 }).toBe(true);
  }, 60000);
});
