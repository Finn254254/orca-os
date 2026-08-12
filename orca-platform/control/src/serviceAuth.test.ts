import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireServiceToken } from "./serviceAuth.js";

function appWith(serviceToken?: string) {
  const app = express();
  app.use(requireServiceToken(serviceToken));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/nodes", (_req, res) => res.json([]));
  return app;
}

describe("requireServiceToken", () => {
  it("allows every request when no service token is configured (default)", async () => {
    const app = appWith(undefined);
    expect((await request(app).get("/nodes")).status).toBe(200);
  });

  it("always allows /health, even when a token is configured", async () => {
    const app = appWith("secret");
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("rejects requests without a token when one is configured", async () => {
    const app = appWith("secret");
    expect((await request(app).get("/nodes")).status).toBe(401);
  });

  it("rejects requests with the wrong token", async () => {
    const app = appWith("secret");
    const res = await request(app).get("/nodes").set("authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("allows requests with the correct token", async () => {
    const app = appWith("secret");
    const res = await request(app).get("/nodes").set("authorization", "Bearer secret");
    expect(res.status).toBe(200);
  });
});
