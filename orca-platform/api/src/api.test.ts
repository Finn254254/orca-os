import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeshClient } from "@orca/mesh";
import { createControlServer, type ControlServerHandle } from "@orca/control/src/server.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApiServer, type ApiServerHandle } from "./server.js";

const CLUSTER_TOKEN = "api-test-cluster-token";
const SESSION_SECRET = "api-test-session-secret";
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin-password";

function waitFor<T>(emitter: { once: (event: string, cb: (...a: unknown[]) => void) => void }, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, (payload: unknown) => resolve(payload as T)));
}

async function waitUntil(predicate: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitUntil timed out");
}

describe("orca-api", () => {
  let controlHandle: ControlServerHandle;
  let apiHandle: ApiServerHandle;
  let controlDir: string;
  let apiDir: string;
  let apiBaseUrl: string;
  let controlWsUrl: string;
  let adminToken: string;

  beforeEach(async () => {
    controlDir = await mkdtemp(join(tmpdir(), "orca-api-control-"));
    apiDir = await mkdtemp(join(tmpdir(), "orca-api-data-"));

    controlHandle = await createControlServer({
      port: 0,
      dataDir: controlDir,
      clusterToken: CLUSTER_TOKEN,
      clusterName: "api-test-cluster",
    });
    const controlAddress = controlHandle.httpServer.address();
    const controlPort = typeof controlAddress === "object" && controlAddress ? controlAddress.port : 0;
    controlWsUrl = `ws://127.0.0.1:${controlPort}/mesh`;

    apiHandle = await createApiServer({
      port: 0,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      dataDir: apiDir,
      sessionSecret: SESSION_SECRET,
      pollIntervalMs: 50,
      bootstrapAdminUsername: ADMIN_USER,
      bootstrapAdminPassword: ADMIN_PASS,
    });
    const apiAddress = apiHandle.httpServer.address();
    const apiPort = typeof apiAddress === "object" && apiAddress ? apiAddress.port : 0;
    apiBaseUrl = `http://127.0.0.1:${apiPort}`;

    const loginRes = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = loginRes.body.token;
  });

  afterEach(async () => {
    await apiHandle.close();
    await controlHandle.close();
    await rm(controlDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("bootstraps an admin user and issues a working session token", async () => {
    expect(adminToken).toBeTruthy();
    const me = await request(apiBaseUrl).get("/api/v1/auth/me").set("authorization", `Bearer ${adminToken}`);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(ADMIN_USER);
    expect(me.body.role).toBe("admin");
  });

  it("rejects invalid credentials", async () => {
    const res = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: ADMIN_USER, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("requires auth on protected routes", async () => {
    const res = await request(apiBaseUrl).get("/api/v1/nodes");
    expect(res.status).toBe(401);
  });

  it("proxies node data from Control once a node registers", async () => {
    const client = new MeshClient({ url: controlWsUrl, token: CLUSTER_TOKEN, nodeId: "node_x", name: "proxy-node" });
    client.start();
    await waitFor(client, "ack");

    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get("/api/v1/nodes").set("authorization", `Bearer ${adminToken}`);
      return res.status === 200 && res.body.length === 1 && res.body[0].name === "proxy-node";
    });

    client.stop();
  });

  it("enforces role-based access for commands and user management", async () => {
    const viewerCreate = await request(apiBaseUrl)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "viewer1", password: "pw123456", role: "viewer" });
    expect(viewerCreate.status).toBe(201);

    const viewerLogin = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "viewer1", password: "pw123456" });
    const viewerToken = viewerLogin.body.token;

    const forbiddenUsers = await request(apiBaseUrl).get("/api/v1/users").set("authorization", `Bearer ${viewerToken}`);
    expect(forbiddenUsers.status).toBe(403);

    const forbiddenCommand = await request(apiBaseUrl)
      .post("/api/v1/nodes/node_nope/commands")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ type: "ping" });
    expect(forbiddenCommand.status).toBe(403);
  });

  it("serves an OpenAPI document", async () => {
    const res = await request(apiBaseUrl).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.paths).toBeDefined();
    expect(res.body.paths["/nodes"]).toBeDefined();
  });
});
