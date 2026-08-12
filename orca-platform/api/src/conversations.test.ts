import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createControlServer, type ControlServerHandle } from "@orca/control/src/server.js";
import { createApiServer, type ApiServerHandle } from "./server.js";

const CLUSTER_TOKEN = "conv-test-token";
const SESSION_SECRET = "conv-session-secret";

describe("Orca AI conversations", () => {
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
        const parsed = JSON.parse(body || "{}");
        if (req.url === "/v1/chat/completions") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":", world"}}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
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

    controlDir = await mkdtemp(join(tmpdir(), "orca-conv-control-"));
    apiDir = await mkdtemp(join(tmpdir(), "orca-conv-api-"));

    controlHandle = await createControlServer({ port: 0, dataDir: controlDir, clusterToken: CLUSTER_TOKEN, clusterName: "conv-cluster" });
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

    // Register the model so the gateway knows which runtime it belongs to.
    await request(apiBaseUrl).post("/api/v1/models/pull").set("authorization", `Bearer ${adminToken}`).send({ runtime: "ollama", name: "llama3" });
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    await apiHandle.close();
    await controlHandle.close();
    fakeRuntime.close();
    process.env.ORCA_OLLAMA_URL = originalOllamaUrl;
    await rm(controlDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("creates a conversation, sends a message, and persists the streamed reply", async () => {
    const createRes = await request(apiBaseUrl)
      .post("/api/v1/ai/conversations")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ model: "llama3", title: "Test chat" });
    expect(createRes.status).toBe(201);
    const conversationId = createRes.body.id;

    const messageRes = await request(apiBaseUrl)
      .post(`/api/v1/ai/conversations/${conversationId}/messages`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({ content: "hi there" });
    expect(messageRes.status).toBe(200);
    expect(messageRes.text).toContain("Hello");

    const getRes = await request(apiBaseUrl).get(`/api/v1/ai/conversations/${conversationId}`).set("authorization", `Bearer ${adminToken}`);
    expect(getRes.body.messages).toHaveLength(2);
    expect(getRes.body.messages[0]).toMatchObject({ role: "user", content: "hi there" });
    expect(getRes.body.messages[1]).toMatchObject({ role: "assistant", content: "Hello, world" });
  });

  it("lists only the requesting user's conversations", async () => {
    await request(apiBaseUrl).post("/api/v1/ai/conversations").set("authorization", `Bearer ${adminToken}`).send({ model: "llama3" });

    await request(apiBaseUrl)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "other", password: "pw123456", role: "viewer" });
    const otherLogin = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "other", password: "pw123456" });

    const otherList = await request(apiBaseUrl).get("/api/v1/ai/conversations").set("authorization", `Bearer ${otherLogin.body.token}`);
    expect(otherList.body).toHaveLength(0);

    const adminList = await request(apiBaseUrl).get("/api/v1/ai/conversations").set("authorization", `Bearer ${adminToken}`);
    expect(adminList.body).toHaveLength(1);
  });

  it("404s accessing another user's conversation", async () => {
    const createRes = await request(apiBaseUrl).post("/api/v1/ai/conversations").set("authorization", `Bearer ${adminToken}`).send({ model: "llama3" });

    await request(apiBaseUrl)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "intruder", password: "pw123456", role: "viewer" });
    const intruderLogin = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "intruder", password: "pw123456" });

    const res = await request(apiBaseUrl)
      .get(`/api/v1/ai/conversations/${createRes.body.id}`)
      .set("authorization", `Bearer ${intruderLogin.body.token}`);
    expect(res.status).toBe(404);
  });

  it("renames and deletes a conversation", async () => {
    const createRes = await request(apiBaseUrl).post("/api/v1/ai/conversations").set("authorization", `Bearer ${adminToken}`).send({ model: "llama3" });
    const renameRes = await request(apiBaseUrl)
      .put(`/api/v1/ai/conversations/${createRes.body.id}`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({ title: "Renamed" });
    expect(renameRes.body.title).toBe("Renamed");

    const deleteRes = await request(apiBaseUrl).delete(`/api/v1/ai/conversations/${createRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);
    expect((await request(apiBaseUrl).get(`/api/v1/ai/conversations/${createRes.body.id}`).set("authorization", `Bearer ${adminToken}`)).status).toBe(404);
  });
});
