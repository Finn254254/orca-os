import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelStore } from "@orca/models";
import { AiGatewayService } from "./gatewayService.js";
import { createAiGatewayRouter } from "./routes.js";

describe("ai-gateway router", () => {
  let dir: string;
  let app: express.Express;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-ai-gateway-routes-"));
    const models = new ModelStore(dir);
    await models.init();
    await models.register({ name: "llama3", runtime: "ollama", state: "available" });
    const gateway = new AiGatewayService({ models, runtimeUrls: {} });
    app = express();
    app.use(express.json());
    app.use("/api/v1/ai", createAiGatewayRouter(gateway));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("lists models in OpenAI list format", async () => {
    const res = await request(app).get("/api/v1/ai/models");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ object: "list", data: [expect.objectContaining({ id: "llama3" })] });
  });

  it("rejects a malformed chat completion request with an OpenAI-shaped error", async () => {
    const res = await request(app).post("/api/v1/ai/chat/completions").send({ model: "llama3" });
    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe("invalid_request_error");
  });

  it("returns a gateway error when no runtime endpoint is configured", async () => {
    const res = await request(app)
      .post("/api/v1/ai/chat/completions")
      .send({ model: "llama3", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(503);
    expect(res.body.error.type).toBe("gateway_error");
  });
});
