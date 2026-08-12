import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_ROOT, pickPort, spawnService, waitUntil, type SpawnedProcess } from "./support.js";

const execFileAsync = promisify(execFile);
const CLUSTER_TOKEN = "cli-e2e-cluster-token";
const SESSION_SECRET = "cli-e2e-session-secret";

async function runCli(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [join(PLATFORM_ROOT, "cli/bin/orca.mjs"), ...args], {
      env: { ...process.env, ...env },
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}

describe("orca CLI end-to-end", () => {
  let controlProc: SpawnedProcess | undefined;
  let apiProc: SpawnedProcess | undefined;
  let agentProc: SpawnedProcess | undefined;
  let dirs: string[] = [];

  afterEach(async () => {
    await agentProc?.stop();
    await apiProc?.stop();
    await controlProc?.stop();
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    dirs = [];
  });

  it("logs in and reads cluster status/nodes through the real API", async () => {
    const controlPort = pickPort();
    const apiPort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-cli-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-cli-api-"));
    const cliConfigDir = await mkdtemp(join(tmpdir(), "orca-cli-home-"));
    dirs = [controlDir, apiDir, cliConfigDir];

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
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    const cliEnv = { ORCA_CLI_CONFIG_DIR: cliConfigDir };

    const login = await runCli(["login", "--url", `http://127.0.0.1:${apiPort}`, "-u", "admin", "-p", "admin-password"], cliEnv);
    expect(login.code).toBe(0);
    expect(login.stdout).toContain("logged in as admin");

    const status = await runCli(["status"], cliEnv);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("orca-cluster");
    expect(status.stdout).toContain("0 total");

    const nodes = await runCli(["nodes"], cliEnv);
    expect(nodes.code).toBe(0);
    expect(nodes.stdout).toContain("(none)");

    const version = await runCli(["version"], cliEnv);
    expect(version.code).toBe(0);
    expect(version.stdout).toContain("orca-api  ok");

    const models = await runCli(["models"], cliEnv);
    expect(models.code).toBe(0);
    expect(models.stdout).toContain("(none)");

    const planned = await runCli(["power"], cliEnv);
    expect(planned.code).toBe(1);
    expect(planned.stderr).toContain("Orca Hardware Daemon");
  }, 30000);

  it("submits and waits for a compute job via `orca run`", async () => {
    const controlPort = pickPort();
    const apiPort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-cli-run-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-cli-run-api-"));
    const agentDir = await mkdtemp(join(tmpdir(), "orca-cli-run-agent-"));
    const cliConfigDir = await mkdtemp(join(tmpdir(), "orca-cli-run-home-"));
    dirs = [controlDir, apiDir, agentDir, cliConfigDir];

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
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    agentProc = spawnService("agent/src/index.ts", {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${controlPort}/mesh`,
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_NODE_NAME: "cli-run-node",
      ORCA_SIMULATED: "1",
      ORCA_DATA_DIR: agentDir,
      ORCA_LOG_PRETTY: "0",
    });

    const cliEnv = { ORCA_CLI_CONFIG_DIR: cliConfigDir };
    const login = await runCli(["login", "--url", `http://127.0.0.1:${apiPort}`, "-u", "admin", "-p", "admin-password"], cliEnv);
    expect(login.code).toBe(0);

    await waitUntil(async () => {
      const nodes = await runCli(["nodes", "--json"], cliEnv);
      return nodes.code === 0 && JSON.parse(nodes.stdout).some((n: { status: string }) => n.status === "online");
    }, 10000);

    const result = await runCli(["run", "echo", "hi-from-cli"], cliEnv);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("submitted");
    expect(result.stdout).toContain("succeeded");
    expect(result.stdout).toContain("simulated");
  }, 30000);

  it("deploys, inspects, and removes an app via `orca deploy`/`apps`/`app`/`remove`", async () => {
    const controlPort = pickPort();
    const apiPort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-cli-deploy-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-cli-deploy-api-"));
    const agentDir = await mkdtemp(join(tmpdir(), "orca-cli-deploy-agent-"));
    const cliConfigDir = await mkdtemp(join(tmpdir(), "orca-cli-deploy-home-"));
    dirs = [controlDir, apiDir, agentDir, cliConfigDir];

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
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    agentProc = spawnService("agent/src/index.ts", {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${controlPort}/mesh`,
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_NODE_NAME: "cli-deploy-node",
      ORCA_SIMULATED: "1",
      ORCA_DATA_DIR: agentDir,
      ORCA_LOG_PRETTY: "0",
    });

    const cliEnv = { ORCA_CLI_CONFIG_DIR: cliConfigDir };
    const login = await runCli(["login", "--url", `http://127.0.0.1:${apiPort}`, "-u", "admin", "-p", "admin-password"], cliEnv);
    expect(login.code).toBe(0);

    await waitUntil(async () => {
      const nodes = await runCli(["nodes", "--json"], cliEnv);
      return nodes.code === 0 && JSON.parse(nodes.stdout).some((n: { status: string }) => n.status === "online");
    }, 10000);

    const manifestFile = join(cliConfigDir, "manifest.json");
    await import("node:fs/promises").then((fs) => fs.writeFile(manifestFile, JSON.stringify({ name: "web", image: "nginx" })));

    const deployResult = await runCli(["deploy", manifestFile], cliEnv);
    expect(deployResult.code).toBe(0);
    expect(deployResult.stdout).toContain("web");

    let appId = "";
    await waitUntil(async () => {
      const apps = await runCli(["apps", "--json"], cliEnv);
      const parsed = apps.code === 0 ? JSON.parse(apps.stdout) : [];
      const running = parsed.find((a: { state: string; id: string }) => a.state === "running");
      if (running) appId = running.id;
      return Boolean(running);
    }, 10000);

    const detail = await runCli(["app", appId], cliEnv);
    expect(detail.code).toBe(0);
    expect(detail.stdout).toContain("containerId");

    const removeResult = await runCli(["remove", appId], cliEnv);
    expect(removeResult.code).toBe(0);
    expect(removeResult.stdout).toContain("stopped");
  }, 30000);

  it("publishes and rolls out an update via `orca update`", async () => {
    const controlPort = pickPort();
    const apiPort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-cli-update-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-cli-update-api-"));
    const agentDir = await mkdtemp(join(tmpdir(), "orca-cli-update-agent-"));
    const cliConfigDir = await mkdtemp(join(tmpdir(), "orca-cli-update-home-"));
    dirs = [controlDir, apiDir, agentDir, cliConfigDir];

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
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    agentProc = spawnService("agent/src/index.ts", {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${controlPort}/mesh`,
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_NODE_NAME: "cli-update-node",
      ORCA_SIMULATED: "1",
      ORCA_DATA_DIR: agentDir,
      ORCA_LOG_PRETTY: "0",
    });

    const cliEnv = { ORCA_CLI_CONFIG_DIR: cliConfigDir };
    const login = await runCli(["login", "--url", `http://127.0.0.1:${apiPort}`, "-u", "admin", "-p", "admin-password"], cliEnv);
    expect(login.code).toBe(0);

    await waitUntil(async () => {
      const nodes = await runCli(["nodes", "--json"], cliEnv);
      return nodes.code === 0 && JSON.parse(nodes.stdout).some((n: { status: string }) => n.status === "online");
    }, 10000);

    const publish = await runCli(["update", "publish", "1.0.0", "https://example.invalid/img", "sha256:abc"], cliEnv);
    expect(publish.code).toBe(0);
    expect(publish.stdout).toContain("1.0.0");

    const rollout = await runCli(["update", "rollout", "1.0.0"], cliEnv);
    expect(rollout.code).toBe(0);
    const rolloutId = rollout.stdout.match(/rollout (\S+)/)?.[1];
    expect(rolloutId).toBeTruthy();

    await waitUntil(async () => {
      const status = await runCli(["update", "status", rolloutId!], cliEnv);
      return status.code === 0 && JSON.parse(status.stdout).state === "completed";
    }, 10000);
  }, 30000);
});
