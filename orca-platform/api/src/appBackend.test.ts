import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createControlServer, type ControlServerHandle } from "@orca/control/src/server.js";
import { createApiServer, type ApiServerHandle } from "./server.js";

const CLUSTER_TOKEN = "app-backend-test-token";
const SESSION_SECRET = "app-backend-session-secret";

describe("App Backend (mobile/desktop client support)", () => {
  let controlHandle: ControlServerHandle;
  let apiHandle: ApiServerHandle;
  let controlDir: string;
  let apiDir: string;
  let apiBaseUrl: string;
  let adminToken: string;

  beforeEach(async () => {
    controlDir = await mkdtemp(join(tmpdir(), "orca-appbackend-control-"));
    apiDir = await mkdtemp(join(tmpdir(), "orca-appbackend-api-"));

    controlHandle = await createControlServer({ port: 0, dataDir: controlDir, clusterToken: CLUSTER_TOKEN, clusterName: "mobile-cluster" });
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
    await rm(controlDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(apiDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("serves /discover without auth, reflecting the real cluster's name", async () => {
    const res = await request(apiBaseUrl).get("/api/v1/app/discover");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ service: "orca-api", clusterName: "mobile-cluster", apiVersion: "v1" });
  });

  it("requires auth for /summary and reflects real (empty) node counts", async () => {
    expect((await request(apiBaseUrl).get("/api/v1/app/summary")).status).toBe(401);
    const res = await request(apiBaseUrl).get("/api/v1/app/summary").set("authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clusterName: "mobile-cluster", nodeCount: 0, onlineCount: 0 });
  });

  it("broadcasts an admin notification to a real second user and lets them read it", async () => {
    await request(apiBaseUrl)
      .post("/api/v1/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "mobile-user", password: "pw123456", role: "viewer" });
    const userLogin = await request(apiBaseUrl).post("/api/v1/auth/login").send({ username: "mobile-user", password: "pw123456" });
    const userToken = userLogin.body.token;

    // A viewer can't send notifications.
    const forbidden = await request(apiBaseUrl)
      .post("/api/v1/app/notifications")
      .set("authorization", `Bearer ${userToken}`)
      .send({ kind: "system", title: "Nope", message: "should be forbidden" });
    expect(forbidden.status).toBe(403);

    const sendRes = await request(apiBaseUrl)
      .post("/api/v1/app/notifications")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ kind: "system", title: "Maintenance", message: "Cluster restarting at 10pm" });
    expect(sendRes.status).toBe(201);
    expect(sendRes.body).toHaveLength(2); // admin + mobile-user

    const list = await request(apiBaseUrl).get("/api/v1/app/notifications").set("authorization", `Bearer ${userToken}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].title).toBe("Maintenance");

    const markRead = await request(apiBaseUrl).post(`/api/v1/app/notifications/${list.body[0].id}/read`).set("authorization", `Bearer ${userToken}`);
    expect(markRead.status).toBe(200);

    const unread = await request(apiBaseUrl).get("/api/v1/app/notifications?unreadOnly=true").set("authorization", `Bearer ${userToken}`);
    expect(unread.body).toHaveLength(0);
  });

  it("registers and unregisters a device end to end", async () => {
    const registerRes = await request(apiBaseUrl)
      .post("/api/v1/app/devices")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ platform: "android", pushToken: "fcm-token-xyz", label: "Pixel" });
    expect(registerRes.status).toBe(201);

    const listRes = await request(apiBaseUrl).get("/api/v1/app/devices").set("authorization", `Bearer ${adminToken}`);
    expect(listRes.body).toHaveLength(1);

    const deleteRes = await request(apiBaseUrl).delete(`/api/v1/app/devices/${registerRes.body.id}`).set("authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);
  });
});
