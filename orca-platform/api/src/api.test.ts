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
    expect(res.body.paths["/jobs"]).toBeDefined();
  });

  it("submits, schedules, dispatches, and completes a job end-to-end through a real node", async () => {
    const client = new MeshClient({ url: controlWsUrl, token: CLUSTER_TOKEN, nodeId: "node_worker", name: "worker-1" });
    client.on("command", (command) => {
      if (command.type === "run_job") client.sendCommandResult(command.id, "succeeded", { stdout: "job output\n" });
    });
    client.start();
    await waitFor(client, "ack");
    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get("/api/v1/nodes").set("authorization", `Bearer ${adminToken}`);
      return res.body.some((n: { status: string }) => n.status === "online");
    });

    const submitRes = await request(apiBaseUrl)
      .post("/api/v1/jobs")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ type: "shell", command: ["echo", "hi"] });
    expect(submitRes.status).toBe(202);
    expect(submitRes.body.assignedNodeId).toBe("node_worker");

    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get(`/api/v1/jobs/${submitRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
      return res.body.state === "succeeded";
    }, 5000);

    const finalRes = await request(apiBaseUrl).get(`/api/v1/jobs/${submitRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
    expect(finalRes.body.result.stdout).toBe("job output\n");

    client.stop();
  });

  it("deploys and removes an app end-to-end through a real node", async () => {
    const client = new MeshClient({ url: controlWsUrl, token: CLUSTER_TOKEN, nodeId: "node_deploy_worker", name: "deploy-worker-1" });
    client.on("command", (command) => {
      if (command.type === "deploy_app") client.sendCommandResult(command.id, "succeeded", { containerId: "container-abc" });
      if (command.type === "remove_app") client.sendCommandResult(command.id, "succeeded", {});
    });
    client.start();
    await waitFor(client, "ack");
    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get("/api/v1/nodes").set("authorization", `Bearer ${adminToken}`);
      return res.body.some((n: { status: string }) => n.status === "online");
    });

    const deployRes = await request(apiBaseUrl)
      .post("/api/v1/apps")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ name: "web", image: "nginx" });
    expect(deployRes.status).toBe(202);
    expect(deployRes.body.assignedNodeId).toBe("node_deploy_worker");

    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get(`/api/v1/apps/${deployRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
      return res.body.state === "running";
    }, 5000);

    const runningRes = await request(apiBaseUrl).get(`/api/v1/apps/${deployRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
    expect(runningRes.body.containerId).toBe("container-abc");

    const removeRes = await request(apiBaseUrl).delete(`/api/v1/apps/${deployRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.state).toBe("stopped");

    client.stop();
  });

  it("publishes a manifest and rolls it out to a real node end-to-end", async () => {
    const client = new MeshClient({ url: controlWsUrl, token: CLUSTER_TOKEN, nodeId: "node_update_worker", name: "update-worker-1" });
    client.on("command", (command) => {
      if (command.type === "apply_update") client.sendCommandResult(command.id, "succeeded", { installed: true });
    });
    client.start();
    await waitFor(client, "ack");
    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get("/api/v1/nodes").set("authorization", `Bearer ${adminToken}`);
      return res.body.some((n: { status: string }) => n.status === "online");
    });

    const manifestRes = await request(apiBaseUrl)
      .post("/api/v1/updates/manifests")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ version: "2.0.0", artifactUrl: "https://example.invalid/img", checksum: "sha256:xyz" });
    expect(manifestRes.status).toBe(201);

    const rolloutRes = await request(apiBaseUrl)
      .post("/api/v1/updates/rollouts")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ version: "2.0.0" });
    expect(rolloutRes.status).toBe(202);

    await waitUntil(async () => {
      const res = await request(apiBaseUrl).get(`/api/v1/updates/rollouts/${rolloutRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
      return res.body.state === "completed";
    }, 5000);

    client.stop();
  });

  it("runs a real cluster-config backup against the live cluster config", async () => {
    await request(apiBaseUrl).put("/api/v1/cluster/config").set("authorization", `Bearer ${adminToken}`).send({ clusterName: "backup-test-cluster" });

    const backupRes = await request(apiBaseUrl).post("/api/v1/backups").set("authorization", `Bearer ${adminToken}`).send({ kind: "cluster-config" });
    expect(backupRes.status).toBe(202);
    expect(backupRes.body.state).toBe("succeeded");
    expect(backupRes.body.location).toBeTruthy();

    const getRes = await request(apiBaseUrl).get(`/api/v1/backups/${backupRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
    expect(getRes.body.state).toBe("succeeded");

    const restoreRes = await request(apiBaseUrl)
      .post("/api/v1/backups/restores")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ backupJobId: backupRes.body.id, restoredBy: "admin" });
    expect(restoreRes.status).toBe(201);
  });

  it("rejects job submission from a viewer role but allows reading", async () => {
    await request(apiBaseUrl)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "viewer2", password: "pw123456", role: "viewer" });
    const viewerLogin = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "viewer2", password: "pw123456" });
    const viewerToken = viewerLogin.body.token;

    const forbidden = await request(apiBaseUrl)
      .post("/api/v1/jobs")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ type: "shell", command: ["echo", "hi"] });
    expect(forbidden.status).toBe(403);

    const allowed = await request(apiBaseUrl).get("/api/v1/jobs").set("authorization", `Bearer ${viewerToken}`);
    expect(allowed.status).toBe(200);
  });

  it("fails a job immediately when no node is eligible", async () => {
    const res = await request(apiBaseUrl)
      .post("/api/v1/jobs")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ type: "shell", command: ["echo", "hi"], resources: { gpu: true } });
    expect(res.status).toBe(202);
    expect(res.body.state).toBe("failed");
    expect(res.body.failureReason).toBeTruthy();
  });
});
