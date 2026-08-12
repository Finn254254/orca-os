import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { now, type NodeRecord } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { JobService } from "./jobService.js";
import { createJobsRouter } from "./routes.js";
import { JobStore } from "./store.js";

class StaticControlPort implements ControlPort {
  constructor(private readonly nodes: NodeRecord[]) {}
  async listNodes() {
    return this.nodes;
  }
  async createCommand(nodeId: string, type: import("@orca/shared").CommandType, payload: Record<string, unknown>) {
    return { id: "cmd_1", nodeId, type, payload, status: "sent" as const, createdAt: now() };
  }
  async getCommand(id: string) {
    return { id, nodeId: "node_1", type: "run_job" as const, payload: {}, status: "running" as const, createdAt: now() };
  }
}

describe("jobs router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-compute-routes-"));
    const store = new JobStore(dir);
    await store.init();
    const control = new StaticControlPort([
      {
        id: "node_1",
        name: "node-1",
        group: "default",
        status: "online",
        services: [],
        registeredAt: now(),
        labels: {},
        capabilities: { cpuCores: 8, gpus: [], tags: [] },
      },
    ]);
    const jobService = new JobService({ store, control });
    app = express();
    app.use(express.json());
    app.use("/api/v1/jobs", createJobsRouter(jobService));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("rejects an invalid job spec", async () => {
    const res = await request(app).post("/api/v1/jobs").send({});
    expect(res.status).toBe(400);
  });

  it("creates and retrieves a job", async () => {
    const createRes = await request(app)
      .post("/api/v1/jobs")
      .send({ type: "shell", command: ["echo", "hi"] });
    expect(createRes.status).toBe(202);
    expect(createRes.body.state).toBe("running");

    const getRes = await request(app).get(`/api/v1/jobs/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it("404s for an unknown job", async () => {
    const res = await request(app).get("/api/v1/jobs/job_nope");
    expect(res.status).toBe(404);
  });

  it("lists jobs and cancels one", async () => {
    const createRes = await request(app)
      .post("/api/v1/jobs")
      .send({ type: "shell", command: ["sleep", "5"] });

    const listRes = await request(app).get("/api/v1/jobs");
    expect(listRes.body).toHaveLength(1);

    const cancelRes = await request(app).post(`/api/v1/jobs/${createRes.body.id}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.state).toBe("cancelled");
  });
});
