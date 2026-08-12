import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_ROOT, pickPort, spawnService, waitUntil, type SpawnedProcess } from "./support.js";

const CLUSTER_TOKEN = "studio-e2e-cluster-token";
const SESSION_SECRET = "studio-e2e-session-secret";
const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

function spawnVite(cwd: string, port: number, proxyTarget: string): SpawnedProcess {
  const viteBin = join(PLATFORM_ROOT, "node_modules", ".bin", "vite");
  const proc = spawn(viteBin, ["--port", String(port), "--strictPort"], {
    cwd,
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

/** A fake runtime server matching the shapes Ollama's /api/pull and OpenAI-compatible /v1/chat/completions document. */
function createFakeRuntime(): Server {
  return createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/pull") {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ status: "success", total: 1, completed: 1 })}\n`);
        res.end();
        return;
      }
      if (req.url === "/v1/chat/completions") {
        const parsed = JSON.parse(body || "{}");
        const userMessage = parsed.messages?.[parsed.messages.length - 1]?.content ?? "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl_1",
            object: "chat.completion",
            created: 0,
            model: parsed.model,
            choices: [{ index: 0, message: { role: "assistant", content: `echo: ${userMessage}` }, finish_reason: "stop" }],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
}

describe("Orca Studio (browser)", () => {
  let controlProc: SpawnedProcess | undefined;
  let apiProc: SpawnedProcess | undefined;
  let viteProc: SpawnedProcess | undefined;
  let fakeRuntime: Server | undefined;
  let browser: Browser | undefined;
  let dirs: string[] = [];

  afterEach(async () => {
    await browser?.close();
    await Promise.all([viteProc?.stop(), apiProc?.stop(), controlProc?.stop()]);
    if (fakeRuntime) await new Promise<void>((resolve) => fakeRuntime!.close(() => resolve()));
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    dirs = [];
  }, 15000);

  it("logs in, creates an agent config, runs it in the testing console, and shows the run in history", async () => {
    fakeRuntime = createFakeRuntime();
    await new Promise<void>((resolve) => fakeRuntime!.listen(0, resolve));
    const runtimeAddress = fakeRuntime.address();
    const runtimePort = typeof runtimeAddress === "object" && runtimeAddress ? runtimeAddress.port : 0;

    const controlPort = pickPort();
    const apiPort = pickPort();
    const vitePort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-studio-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-studio-api-"));
    dirs = [controlDir, apiDir];

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
      ORCA_OLLAMA_URL: `http://127.0.0.1:${runtimePort}`,
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    const login = await fetch(`http://127.0.0.1:${apiPort}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-password" }),
    }).then((r) => r.json());
    await fetch(`http://127.0.0.1:${apiPort}/api/v1/models/pull`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ runtime: "ollama", name: "llama3" }),
    });
    await new Promise((r) => setTimeout(r, 200));

    viteProc = spawnVite(join(PLATFORM_ROOT, "studio"), vitePort, `http://127.0.0.1:${apiPort}`);
    const studioUrl = `http://127.0.0.1:${vitePort}`;
    await waitUntil(async () => (await fetch(studioUrl).catch(() => undefined))?.ok === true, 20000);

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.goto(`${studioUrl}/login`);
    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${studioUrl}/`);

    // Create a new agent config.
    await expect.poll(() => page.getByLabel("Model").locator("option").count(), { timeout: 10000 }).toBeGreaterThan(0);
    await page.getByPlaceholder("e.g. Research Assistant").fill("Helper");
    await page.getByPlaceholder("You are a helpful assistant that…").fill("Be helpful");
    await page.getByPlaceholder("web_search, calculator").fill("search, calc");
    await page.getByRole("button", { name: "Save" }).click();

    // It should now appear in the sidebar.
    await expect.poll(() => page.locator(".studio-item").count(), { timeout: 10000 }).toBe(1);
    expect(await page.locator(".studio-item").textContent()).toContain("Helper");

    // Run it through the testing console.
    await page.getByPlaceholder("Test input…").fill("hello there");
    await page.getByRole("button", { name: "Run", exact: true }).click();

    await expect.poll(() => page.locator(".studio-console-result").isVisible().catch(() => false), { timeout: 15000 }).toBe(true);
    expect(await page.locator(".studio-console-result").textContent()).toContain("echo: hello there");
    expect(await page.locator(".studio-console-result .status-pill").textContent()).toBe("succeeded");

    // The run should now show up under the Runs tab.
    await page.getByRole("button", { name: "Runs" }).click();
    await expect.poll(() => page.locator(".studio-item").count(), { timeout: 10000 }).toBe(1);
    await page.locator(".studio-item").click();
    await expect.poll(() => page.locator(".studio-console-result").isVisible().catch(() => false), { timeout: 10000 }).toBe(true);
  }, 60000);
});
