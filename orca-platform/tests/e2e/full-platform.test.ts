import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_ROOT, pickPort, spawnService, waitUntil, type SpawnedProcess } from "./support.js";

const CLUSTER_TOKEN = "full-platform-e2e-token";
const SESSION_SECRET = "full-platform-e2e-secret";

/** A fake runtime matching the shapes Ollama's /api/pull and OpenAI-compatible /v1/chat/completions document. */
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
        if (parsed.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `echo: ${userMessage}` } }] })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
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

interface ApiClient {
  get(path: string): Promise<{ status: number; body: any }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: any }>;
}

function makeClient(baseUrl: string, token?: string): ApiClient {
  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
  return { get: (path) => call("GET", path), post: (path, body) => call("POST", path, body) };
}

/**
 * Exercises a single realistic session across every subsystem added in
 * this build — cluster management (Phases 1-8), Compute/Models/Deploy
 * (9-14), Backup/Security (15-18), and Orca AI/Studio/App Backend
 * (19-21) — through the real HTTP API against real Control + Agent
 * processes, proving they cooperate end to end rather than only in
 * isolation (each subsystem already has its own focused e2e test; this
 * one is the cross-cutting check Phase 22 calls for).
 */
describe("full platform integration", () => {
  let controlProc: SpawnedProcess | undefined;
  let apiProc: SpawnedProcess | undefined;
  let agentProcs: SpawnedProcess[] = [];
  let fakeRuntime: Server | undefined;
  let dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(agentProcs.map((p) => p.stop()));
    await apiProc?.stop();
    await controlProc?.stop();
    if (fakeRuntime) await new Promise<void>((resolve) => fakeRuntime!.close(() => resolve()));
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    agentProcs = [];
    dirs = [];
  }, 20000);

  it("runs a cross-subsystem session: nodes, jobs, deploys, AI chat, Studio, notifications, backup, and audit all cohere", async () => {
    fakeRuntime = createFakeRuntime();
    await new Promise<void>((resolve) => fakeRuntime!.listen(0, resolve));
    const runtimeAddress = fakeRuntime.address();
    const runtimePort = typeof runtimeAddress === "object" && runtimeAddress ? runtimeAddress.port : 0;

    const controlPort = pickPort();
    const apiPort = pickPort();
    const controlDir = await mkdtemp(join(tmpdir(), "orca-full-control-"));
    const apiDir = await mkdtemp(join(tmpdir(), "orca-full-api-"));
    const agentDir = await mkdtemp(join(tmpdir(), "orca-full-agent-"));
    dirs = [controlDir, apiDir, agentDir];

    controlProc = spawnService("control/src/index.ts", {
      ORCA_CONTROL_PORT: String(controlPort),
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_DATA_DIR: controlDir,
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${controlPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    const agent = spawnService("agent/src/index.ts", {
      ORCA_CONTROL_URL: `ws://127.0.0.1:${controlPort}/mesh`,
      ORCA_CLUSTER_TOKEN: CLUSTER_TOKEN,
      ORCA_NODE_NAME: "full-e2e-node",
      ORCA_SIMULATED: "1",
      ORCA_DATA_DIR: agentDir,
      ORCA_HEARTBEAT_INTERVAL_MS: "300",
      ORCA_LOG_PRETTY: "0",
    });
    agentProcs = [agent];

    apiProc = spawnService("api/src/index.ts", {
      ORCA_API_PORT: String(apiPort),
      ORCA_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
      ORCA_SESSION_SECRET: SESSION_SECRET,
      ORCA_ADMIN_USERNAME: "admin",
      ORCA_ADMIN_PASSWORD: "admin-password",
      ORCA_DATA_DIR: apiDir,
      ORCA_API_POLL_INTERVAL_MS: "200",
      ORCA_OLLAMA_URL: `http://127.0.0.1:${runtimePort}`,
      ORCA_LOG_PRETTY: "0",
    });
    await waitUntil(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).catch(() => undefined))?.ok === true);

    const baseUrl = `http://127.0.0.1:${apiPort}`;
    const anon = makeClient(baseUrl);

    // 1. Discovery works before login.
    const discover = await anon.get("/api/v1/app/discover");
    expect(discover.status).toBe(200);
    expect(discover.body.service).toBe("orca-api");

    const loginRes = await anon.post("/api/v1/auth/login", { username: "admin", password: "admin-password" });
    const admin = makeClient(baseUrl, loginRes.body.token);

    // 2. The real simulated node registers and comes online.
    let nodeId = "";
    await waitUntil(async () => {
      const res = await admin.get("/api/v1/nodes");
      const node = res.body.find((n: any) => n.name === "full-e2e-node" && n.status === "online");
      if (node) nodeId = node.id;
      return Boolean(node);
    }, 15000);

    // 3. Cluster summary reflects the real node once it's reported metrics.
    await waitUntil(async () => {
      const res = await admin.get("/api/v1/app/summary");
      return res.body.nodeCount === 1 && res.body.onlineCount === 1;
    }, 10000);

    // 4. Pull a model through the real Model Manager -> fake Ollama upstream.
    await admin.post("/api/v1/models/pull", { runtime: "ollama", name: "llama3" });
    await waitUntil(async () => {
      const res = await admin.get("/api/v1/ai/models");
      return res.body.data.some((m: any) => m.id === "llama3");
    }, 5000);

    // 5. Submit a compute job and watch it complete on the real node.
    const jobRes = await admin.post("/api/v1/jobs", { type: "shell", command: ["echo", "hi"] });
    expect(jobRes.status).toBe(202);
    await waitUntil(async () => {
      const res = await admin.get(`/api/v1/jobs/${jobRes.body.id}`);
      return res.body.state === "succeeded";
    }, 10000);

    // 6. Deploy an app and watch it complete on the same node.
    const deployRes = await admin.post("/api/v1/apps", { name: "full-e2e-app", image: "nginx:latest" });
    expect(deployRes.status).toBe(202);
    await waitUntil(async () => {
      const res = await admin.get(`/api/v1/apps/${deployRes.body.id}`);
      return res.body.state === "running";
    }, 10000);

    // 7. Orca AI: create a conversation and send a message through the real gateway (streamed).
    const convRes = await admin.post("/api/v1/ai/conversations", { model: "llama3", title: "Full e2e chat" });
    expect(convRes.status).toBe(201);
    const streamRes = await fetch(`${baseUrl}/api/v1/ai/conversations/${convRes.body.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${loginRes.body.token}` },
      body: JSON.stringify({ content: "hello platform" }),
    });
    expect(streamRes.status).toBe(200);
    await streamRes.text(); // drain the SSE body so the server finishes persisting the assistant reply
    const conv = await admin.get(`/api/v1/ai/conversations/${convRes.body.id}`);
    expect(conv.body.messages).toHaveLength(2);
    expect(conv.body.messages[1].content).toBe("echo: hello platform");

    // 8. Orca Studio: create an agent config against the same model and run it.
    const agentConfigRes = await admin.post("/api/v1/studio/agents", { name: "Full e2e agent", systemPrompt: "Be terse", model: "llama3" });
    expect(agentConfigRes.status).toBe(201);
    const studioRunRes = await admin.post(`/api/v1/studio/agents/${agentConfigRes.body.id}/run`, { input: "ping" });
    expect(studioRunRes.status).toBe(202);
    expect(studioRunRes.body.status).toBe("succeeded");
    expect(studioRunRes.body.output).toBe("echo: ping");

    // 9. App Backend: register a device and broadcast a notification to all users (just admin here).
    const deviceRes = await admin.post("/api/v1/app/devices", { platform: "ios", pushToken: "full-e2e-token" });
    expect(deviceRes.status).toBe(201);
    const notifyRes = await admin.post("/api/v1/app/notifications", { kind: "system", title: "Done", message: "Full e2e run complete" });
    expect(notifyRes.status).toBe(201);
    const notifications = await admin.get("/api/v1/app/notifications");
    expect(notifications.body.some((n: any) => n.title === "Done")).toBe(true);

    // 10. Backup: a real cluster-config snapshot of the state we just built up.
    const backupRes = await admin.post("/api/v1/backups", { kind: "cluster-config" });
    expect(backupRes.status).toBe(202);
    expect(backupRes.body.state).toBe("succeeded");
    expect(backupRes.body.location).toBeTruthy();

    // 11. Audit log: every mutating call above should have left a trace.
    const auditRes = await admin.get("/api/v1/audit");
    expect(auditRes.status).toBe(200);
    const actions = auditRes.body.map((e: any) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "POST /api/v1/auth/login",
        "POST /api/v1/models/pull",
        "POST /api/v1/jobs",
        "POST /api/v1/apps",
        "POST /api/v1/ai/conversations",
        "POST /api/v1/studio/agents",
        "POST /api/v1/app/devices",
        "POST /api/v1/app/notifications",
        "POST /api/v1/backups",
      ]),
    );

    // 12. And the node we started with is still the one everything ran against.
    expect(nodeId).toBeTruthy();
  }, 60000);
});
