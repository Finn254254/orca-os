import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_ROOT, pickPort, spawnService, waitUntil, type SpawnedProcess } from "./support.js";

const CLUSTER_TOKEN = "ai-e2e-cluster-token";
const SESSION_SECRET = "ai-e2e-session-secret";
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
    if (req.url === "/api/pull") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(`${JSON.stringify({ status: "success", total: 1, completed: 1 })}\n`);
      res.end();
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"The answer is "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"**42**."}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

describe("Orca AI (browser)", () => {
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

  it("logs in, creates a conversation, streams a real reply, and renders it as markdown", async () => {
    fakeRuntime = createFakeRuntime();
    await new Promise<void>((resolve) => fakeRuntime!.listen(0, resolve));
    const runtimeAddress = fakeRuntime.address();
    const runtimePort = typeof runtimeAddress === "object" && runtimeAddress ? runtimeAddress.port : 0;

    const controlPort = pickPort();
    const apiPort = pickPort();
    const vitePort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-ai-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-ai-api-"));
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

    // Register a model so the AI Gateway has something to route chat completions to.
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

    viteProc = spawnVite(join(PLATFORM_ROOT, "ai"), vitePort, `http://127.0.0.1:${apiPort}`);
    const aiUrl = `http://127.0.0.1:${vitePort}`;
    await waitUntil(async () => (await fetch(aiUrl).catch(() => undefined))?.ok === true, 20000);

    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.goto(`${aiUrl}/login`);
    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${aiUrl}/`);

    // Model picker should show the registered model, not a placeholder.
    await expect.poll(() => page.getByLabel("Model").locator("option").count(), { timeout: 10000 }).toBeGreaterThan(0);
    expect(await page.getByLabel("Model").inputValue()).toBe("llama3");

    await page.getByPlaceholder("Message Orca AI…").fill("what is the answer to everything?");
    await page.getByRole("button", { name: "Send" }).click();

    // The streamed reply should render, with markdown bold converted to a real <strong>.
    await expect.poll(() => page.locator(".ai-message-assistant strong").isVisible().catch(() => false), { timeout: 15000 }).toBe(true);
    expect(await page.locator(".ai-message-assistant").textContent()).toContain("The answer is 42.");
    expect(await page.locator(".ai-message-assistant strong").textContent()).toBe("42");

    // The new conversation should now show up in the sidebar.
    await expect.poll(() => page.locator(".ai-conversation-item").count(), { timeout: 10000 }).toBe(1);
    expect(await page.locator(".ai-conversation-item").textContent()).toContain("what is the answer to everything?");

    // Rename via double-click, then delete.
    await page.locator(".ai-conversation-title").dblclick();
    await page.locator(".ai-conversation-item input").fill("Renamed chat");
    await page.locator(".ai-conversation-item input").press("Enter");
    await expect.poll(() => page.locator(".ai-conversation-item").textContent(), { timeout: 10000 }).toContain("Renamed chat");

    await page.locator(".ai-delete-btn").click();
    await expect.poll(() => page.locator(".ai-conversation-item").count(), { timeout: 10000 }).toBe(0);
  }, 60000);
});
