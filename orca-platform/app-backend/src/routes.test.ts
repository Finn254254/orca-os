import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type ClusterConfig, type NodeRecord } from "@orca/shared";
import { AppBackendService, type ClusterPort, type UserDirectory } from "./appBackendService.js";
import { DeviceStore } from "./deviceStore.js";
import { NotificationStore } from "./notificationStore.js";
import { createAppBackendRouter } from "./routes.js";

const CONFIG: ClusterConfig = { clusterName: "route-test-cluster", groups: [], heartbeatIntervalMs: 1000, heartbeatTimeoutMs: 5000, settings: {} };

class StaticCluster implements ClusterPort {
  async getClusterConfig() {
    return CONFIG;
  }
  async listNodes(): Promise<(NodeRecord & { connected: boolean })[]> {
    return [];
  }
}

class StaticUsers implements UserDirectory {
  listUserIds() {
    return ["user_1", "user_2"];
  }
}

// Test-only stand-ins for the real requireAuth/requireRole middleware: reads
// role/userId from headers instead of verifying a real session token, so
// this test can exercise the router's own auth wiring (which routes require
// auth, which require a role) without pulling in @orca/security's HTTP auth.
function fakeRequireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.header("x-test-user");
  if (!userId) {
    res.status(401).json({ error: "missing x-test-user" });
    return;
  }
  req.user = { userId, username: userId, role: (req.header("x-test-role") as "admin" | "operator" | "viewer") ?? "viewer" };
  next();
}

function fakeRequireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "insufficient permissions" });
      return;
    }
    next();
  };
}

describe("app-backend router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-app-backend-routes-"));
    const notifications = new NotificationStore(dir);
    await notifications.init();
    const devices = new DeviceStore(dir);
    await devices.init();
    const service = new AppBackendService({ cluster: new StaticCluster(), users: new StaticUsers(), notifications, devices });

    app = express();
    app.use(express.json());
    app.use("/api/v1/app", createAppBackendRouter(service, fakeRequireAuth, fakeRequireRole("admin", "operator")));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("serves /discover with no auth required", async () => {
    const res = await request(app).get("/api/v1/app/discover");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ service: "orca-api", clusterName: "route-test-cluster" });
  });

  it("requires auth for /summary", async () => {
    expect((await request(app).get("/api/v1/app/summary")).status).toBe(401);
    const res = await request(app).get("/api/v1/app/summary").set("x-test-user", "user_1");
    expect(res.status).toBe(200);
    expect(res.body.clusterName).toBe("route-test-cluster");
  });

  it("lets a viewer read their own notifications but not broadcast one", async () => {
    const sendRes = await request(app)
      .post("/api/v1/app/notifications")
      .set("x-test-user", "user_1")
      .set("x-test-role", "viewer")
      .send({ kind: "system", title: "Hi", message: "hello" });
    expect(sendRes.status).toBe(403);

    const adminSend = await request(app)
      .post("/api/v1/app/notifications")
      .set("x-test-user", "admin_1")
      .set("x-test-role", "admin")
      .send({ userId: "user_1", kind: "system", title: "Hi", message: "hello" });
    expect(adminSend.status).toBe(201);

    const list = await request(app).get("/api/v1/app/notifications").set("x-test-user", "user_1");
    expect(list.body).toHaveLength(1);

    const markRead = await request(app).post(`/api/v1/app/notifications/${list.body[0].id}/read`).set("x-test-user", "user_1");
    expect(markRead.status).toBe(200);
    expect(markRead.body.readAt).toBeDefined();
  });

  it("registers and unregisters a device, scoped to its owner", async () => {
    const registerRes = await request(app)
      .post("/api/v1/app/devices")
      .set("x-test-user", "user_1")
      .send({ platform: "ios", pushToken: "abc123" });
    expect(registerRes.status).toBe(201);

    const listRes = await request(app).get("/api/v1/app/devices").set("x-test-user", "user_1");
    expect(listRes.body).toHaveLength(1);

    const deleteAsOther = await request(app).delete(`/api/v1/app/devices/${registerRes.body.id}`).set("x-test-user", "user_2");
    expect(deleteAsOther.status).toBe(404);

    const deleteRes = await request(app).delete(`/api/v1/app/devices/${registerRes.body.id}`).set("x-test-user", "user_1");
    expect(deleteRes.status).toBe(204);
  });

  it("rejects a malformed device registration with 400", async () => {
    const res = await request(app).post("/api/v1/app/devices").set("x-test-user", "user_1").send({ platform: "toaster", pushToken: "x" });
    expect(res.status).toBe(400);
  });
});
