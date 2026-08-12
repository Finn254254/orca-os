import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeAdapter } from "./adapters/types.js";
import { ModelService } from "./modelService.js";
import { createModelsRouter } from "./routes.js";
import { ModelStore } from "./store.js";

class FakeAdapter implements RuntimeAdapter {
  readonly runtime = "ollama" as const;
  async listAvailable() {
    return [];
  }
  async pullModel(_name: string, onProgress?: (pct: number) => void) {
    onProgress?.(100);
  }
  async deleteModel() {}
}

describe("models router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-models-routes-"));
    const store = new ModelStore(dir);
    await store.init();
    const service = new ModelService({ store, adapters: { ollama: new FakeAdapter() } });
    app = express();
    app.use(express.json());
    app.use("/api/v1/models", createModelsRouter(service));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("rejects an invalid pull request", async () => {
    const res = await request(app).post("/api/v1/models/pull").send({});
    expect(res.status).toBe(400);
  });

  it("pulls, lists, and fetches a model", async () => {
    const pullRes = await request(app).post("/api/v1/models/pull").send({ runtime: "ollama", name: "llama3" });
    expect(pullRes.status).toBe(202);
    expect(pullRes.body.state).toBe("downloading");

    const listRes = await request(app).get("/api/v1/models");
    expect(listRes.body).toHaveLength(1);

    const getRes = await request(app).get(`/api/v1/models/${pullRes.body.id}`);
    expect(getRes.status).toBe(200);
  });

  it("404s for an unknown model", async () => {
    expect((await request(app).get("/api/v1/models/model_nope")).status).toBe(404);
    expect((await request(app).delete("/api/v1/models/model_nope")).status).toBe(404);
  });

  it("rejects pulling from an unconfigured runtime with 400", async () => {
    const res = await request(app).post("/api/v1/models/pull").send({ runtime: "llamacpp", name: "x" });
    expect(res.status).toBe(400);
  });
});
