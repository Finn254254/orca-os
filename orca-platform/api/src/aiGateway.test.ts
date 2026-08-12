import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createControlServer, type ControlServerHandle } from "@orca/control/src/server.js";
import { createApiServer, type ApiServerHandle } from "./server.js";

const CLUSTER_TOKEN = "ai-gateway-test-token";
const SESSION_SECRET = "ai-gateway-session-secret";

describe("AI Gateway through the real API server", () => {
  let ollamaServer: Server;
  let ollamaUrl: string;
  let controlHandle: ControlServerHandle;
  let apiHandle: ApiServerHandle;
  let controlDir: string;
  let apiDir: string;
  let apiBaseUrl: string;
  let adminToken: string;
  let originalOllamaUrl: string | undefined;

  beforeEach(async () => {
    ollamaServer = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        if (req.url === "/api/pull") {
          // Real Ollama pull-progress shape (see @orca/models OllamaAdapter).
          res.writeHead(200, { "content-type": "application/x-ndjson" });
          res.write(`${JSON.stringify({ status: "success" })}\n`);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-fake",
            object: "chat.completion",
            created: 1,
            model: parsed.model,
            choices: [{ index: 0, message: { role: "assistant", content: "hello from fake ollama" }, finish_reason: "stop" }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => ollamaServer.listen(0, resolve));
    const ollamaAddress = ollamaServer.address();
    const ollamaPort = typeof ollamaAddress === "object" && ollamaAddress ? ollamaAddress.port : 0;
    ollamaUrl = `http://127.0.0.1:${ollamaPort}`;
    originalOllamaUrl = process.env.ORCA_OLLAMA_URL;
    process.env.ORCA_OLLAMA_URL = ollamaUrl;

    controlDir = await mkdtemp(join(tmpdir(), "orca-aig-control-"));
    apiDir = await mkdtemp(join(tmpdir(), "orca-aig-api-"));

    controlHandle = await createControlServer({ port: 0, dataDir: controlDir, clusterToken: CLUSTER_TOKEN, clusterName: "aig-cluster" });
    const controlAddress = controlHandle.httpServer.address();
    const controlPort = typeof controlAddress === "object" && controlAddress ? controlAddress.port : 0;

    apiHandle = await createApiServer({
      port: 0,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      dataDir: apiDir,
      sessionSecret: SESSION_SECRET,
      pollIntervalMs: 1000,
      bootstrapAdminUsername: "admin",
      bootstrapAdminPassword: "admin-password",
    });
    const apiAddress = apiHandle.httpServer.address();
    const apiPort = typeof apiAddress === "object" && apiAddress ? apiAddress.port : 0;
    apiBaseUrl = `http://127.0.0.1:${apiPort}`;

    const login = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "admin", password: "admin-password" });
    adminToken = login.body.token;
  });

  afterEach(async () => {
    await apiHandle.close();
    await controlHandle.close();
    ollamaServer.close();
    process.env.ORCA_OLLAMA_URL = originalOllamaUrl;
    await rm(controlDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("routes a chat completion to the fake Ollama upstream through the real API", async () => {
    const pullRes = await request(apiBaseUrl)
      .post("/api/v1/models/pull")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ runtime: "ollama", name: "llama3" });
    expect(pullRes.status).toBe(202);

    await new Promise((r) => setTimeout(r, 50));

    const chatRes = await request(apiBaseUrl)
      .post("/api/v1/ai/chat/completions")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ model: "llama3", messages: [{ role: "user", content: "hi" }] });

    expect(chatRes.status).toBe(200);
    expect(chatRes.body.choices[0].message.content).toBe("hello from fake ollama");
  });

  it("lists the pulled model via /api/v1/ai/models", async () => {
    await request(apiBaseUrl).post("/api/v1/models/pull").set("authorization", `Bearer ${adminToken}`).send({ runtime: "ollama", name: "llama3" });
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(apiBaseUrl).get("/api/v1/ai/models").set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((m: { id: string }) => m.id === "llama3")).toBe(true);
  });

  it("returns a 404 model-not-found for an unregistered model", async () => {
    const res = await request(apiBaseUrl)
      .post("/api/v1/ai/chat/completions")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ model: "never-pulled", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(404);
    expect(res.body.error.type).toBe("gateway_error");
  });
});
