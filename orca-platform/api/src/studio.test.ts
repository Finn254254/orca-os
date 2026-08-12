import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createControlServer, type ControlServerHandle } from "@orca/control/src/server.js";
import { createApiServer, type ApiServerHandle } from "./server.js";

const CLUSTER_TOKEN = "studio-test-token";
const SESSION_SECRET = "studio-session-secret";

describe("Orca Studio", () => {
  let fakeRuntime: Server;
  let controlHandle: ControlServerHandle;
  let apiHandle: ApiServerHandle;
  let controlDir: string;
  let apiDir: string;
  let apiBaseUrl: string;
  let adminToken: string;
  let originalOllamaUrl: string | undefined;

  beforeEach(async () => {
    fakeRuntime = createServer((req, res) => {
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
    await new Promise<void>((resolve) => fakeRuntime.listen(0, resolve));
    const runtimeAddress = fakeRuntime.address();
    const runtimePort = typeof runtimeAddress === "object" && runtimeAddress ? runtimeAddress.port : 0;
    originalOllamaUrl = process.env.ORCA_OLLAMA_URL;
    process.env.ORCA_OLLAMA_URL = `http://127.0.0.1:${runtimePort}`;

    controlDir = await mkdtemp(join(tmpdir(), "orca-studio-control-"));
    apiDir = await mkdtemp(join(tmpdir(), "orca-studio-api-"));

    controlHandle = await createControlServer({ port: 0, dataDir: controlDir, clusterToken: CLUSTER_TOKEN, clusterName: "studio-cluster" });
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

    await request(apiBaseUrl).post("/api/v1/models/pull").set("authorization", `Bearer ${adminToken}`).send({ runtime: "ollama", name: "llama3" });
    await new Promise((r) => setTimeout(r, 100));
  });

  afterEach(async () => {
    await apiHandle.close();
    await controlHandle.close();
    fakeRuntime.close();
    process.env.ORCA_OLLAMA_URL = originalOllamaUrl;
    await rm(controlDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("creates an agent config and runs it through the AI Gateway, recording a succeeded run", async () => {
    const createRes = await request(apiBaseUrl)
      .post("/api/v1/studio/agents")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ name: "Helper", systemPrompt: "Be helpful", model: "llama3", tools: ["search"] });
    expect(createRes.status).toBe(201);
    expect(createRes.body.tools).toEqual(["search"]);

    const runRes = await request(apiBaseUrl)
      .post(`/api/v1/studio/agents/${createRes.body.id}/run`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({ input: "hello" });
    expect(runRes.status).toBe(202);
    expect(runRes.body.status).toBe("succeeded");
    expect(runRes.body.output).toBe("echo: hello");

    const runsRes = await request(apiBaseUrl).get("/api/v1/studio/runs").set("authorization", `Bearer ${adminToken}`);
    expect(runsRes.body).toHaveLength(1);
  });

  it("404s running or accessing another user's agent config", async () => {
    const createRes = await request(apiBaseUrl)
      .post("/api/v1/studio/agents")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ name: "Mine", systemPrompt: "x", model: "llama3" });

    await request(apiBaseUrl)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "intruder", password: "pw123456", role: "viewer" });
    const intruderLogin = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "intruder", password: "pw123456" });

    const getRes = await request(apiBaseUrl).get(`/api/v1/studio/agents/${createRes.body.id}`).set("authorization", `Bearer ${intruderLogin.body.token}`);
    expect(getRes.status).toBe(404);

    const runRes = await request(apiBaseUrl)
      .post(`/api/v1/studio/agents/${createRes.body.id}/run`)
      .set("authorization", `Bearer ${intruderLogin.body.token}`)
      .send({ input: "hi" });
    expect(runRes.status).toBe(404);
  });

  it("creates a two-step workflow and runs it end to end, chaining outputs", async () => {
    const step1 = await request(apiBaseUrl)
      .post("/api/v1/studio/agents")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ name: "Step1", systemPrompt: "s1", model: "llama3" });
    const step2 = await request(apiBaseUrl)
      .post("/api/v1/studio/agents")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ name: "Step2", systemPrompt: "s2", model: "llama3" });

    const workflowRes = await request(apiBaseUrl)
      .post("/api/v1/studio/workflows")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ name: "Pipeline", steps: [{ agentConfigId: step1.body.id }, { agentConfigId: step2.body.id }] });
    expect(workflowRes.status).toBe(201);

    const runRes = await request(apiBaseUrl)
      .post(`/api/v1/studio/workflows/${workflowRes.body.id}/run`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({ input: "start" });
    expect(runRes.status).toBe(202);
    expect(runRes.body.status).toBe("succeeded");
    expect(runRes.body.steps).toHaveLength(2);
    expect(runRes.body.steps[0].output).toBe("echo: start");
    expect(runRes.body.steps[1].input).toBe("echo: start");
    expect(runRes.body.output).toBe("echo: echo: start");
  });

  it("rejects a malformed agent config with a 400", async () => {
    const res = await request(apiBaseUrl).post("/api/v1/studio/agents").set("authorization", `Bearer ${adminToken}`).send({ name: "" });
    expect(res.status).toBe(400);
  });
});
