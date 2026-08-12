import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OllamaAdapter } from "./ollama.js";

/**
 * These tests exercise OllamaAdapter against a fake HTTP server that mimics
 * Ollama's documented API shape (GET /api/tags, POST /api/pull streaming
 * NDJSON, DELETE /api/delete) — not a live Ollama instance (unavailable in
 * this environment). See ollama.ts's module doc comment.
 */
describe("OllamaAdapter", () => {
  let server: Server;
  let baseUrl: string;
  let lastDeleteBody: unknown;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.method === "GET" && req.url === "/api/tags") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ models: [{ name: "llama3", size: 4_000_000_000, details: { format: "gguf" } }] }));
          return;
        }
        if (req.method === "POST" && req.url === "/api/pull") {
          res.writeHead(200, { "content-type": "application/x-ndjson" });
          res.write(`${JSON.stringify({ status: "pulling", digest: "sha1", total: 100, completed: 25 })}\n`);
          res.write(`${JSON.stringify({ status: "pulling", digest: "sha1", total: 100, completed: 100 })}\n`);
          res.write(`${JSON.stringify({ status: "success" })}\n`);
          res.end();
          return;
        }
        if (req.method === "POST" && req.url === "/api/pull-error") {
          res.writeHead(200, { "content-type": "application/x-ndjson" });
          res.write(`${JSON.stringify({ status: "error", error: "model not found" })}\n`);
          res.end();
          return;
        }
        if (req.method === "DELETE" && req.url === "/api/delete") {
          lastDeleteBody = JSON.parse(body);
          res.writeHead(200);
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("lists available models from /api/tags", async () => {
    const adapter = new OllamaAdapter(baseUrl);
    const list = await adapter.listAvailable();
    expect(list).toEqual([{ name: "llama3", sizeBytes: 4_000_000_000, format: "gguf" }]);
  });

  it("reports pull progress and resolves on success", async () => {
    const adapter = new OllamaAdapter(baseUrl);
    const progress: number[] = [];
    await adapter.pullModel("llama3", (pct) => progress.push(pct));
    expect(progress).toContain(25);
    expect(progress).toContain(100);
    expect(progress.at(-1)).toBe(100);
  });

  it("deletes a model via DELETE /api/delete", async () => {
    const adapter = new OllamaAdapter(baseUrl);
    await adapter.deleteModel("llama3");
    expect(lastDeleteBody).toEqual({ name: "llama3" });
  });
});
