import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ModelStore } from "@orca/models";
import { AiGatewayService } from "./gatewayService.js";
import { GatewayError } from "./types.js";

/** Fake upstream mimicking the OpenAI-compatible /v1/chat/completions endpoint both Ollama and llama.cpp's servers expose. */
describe("AiGatewayService", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequestBody: unknown;
  let dir: string;
  let models: ModelStore;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        lastRequestBody = parsed;
        if (req.url !== "/v1/chat/completions") {
          res.writeHead(404);
          res.end();
          return;
        }
        if (parsed.model === "boom") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "upstream exploded" }));
          return;
        }
        if (parsed.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 1,
            model: parsed.model,
            choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        );
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

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-ai-gateway-"));
    models = new ModelStore(dir);
    await models.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("lists only available/loaded models in OpenAI list format", async () => {
    await models.register({ name: "llama3", runtime: "ollama", state: "available" });
    await models.register({ name: "downloading-model", runtime: "ollama", state: "downloading" });
    const gateway = new AiGatewayService({ models, runtimeUrls: { ollama: baseUrl } });
    const list = gateway.listModels();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "llama3", object: "model", owned_by: "ollama" });
  });

  it("rejects a chat completion for an unregistered model", async () => {
    const gateway = new AiGatewayService({ models, runtimeUrls: { ollama: baseUrl } });
    await expect(gateway.chatCompletion({ model: "nope", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(GatewayError);
  });

  it("rejects a chat completion when no endpoint is configured for the model's runtime", async () => {
    await models.register({ name: "local-model", runtime: "llamacpp", state: "available" });
    const gateway = new AiGatewayService({ models, runtimeUrls: {} });
    await expect(gateway.chatCompletion({ model: "local-model", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /no endpoint configured/,
    );
  });

  it("routes a chat completion to the model's configured runtime endpoint", async () => {
    await models.register({ name: "llama3", runtime: "ollama", state: "available" });
    const gateway = new AiGatewayService({ models, runtimeUrls: { ollama: baseUrl } });
    const result = await gateway.chatCompletion({ model: "llama3", messages: [{ role: "user", content: "hi" }] });
    expect(result.choices[0].message.content).toBe("hi there");
    expect(result.usage?.total_tokens).toBe(7);
    expect(lastRequestBody).toMatchObject({ model: "llama3", stream: false });
  });

  it("surfaces upstream errors as a GatewayError with the upstream status", async () => {
    await models.register({ name: "boom", runtime: "ollama", state: "available" });
    const gateway = new AiGatewayService({ models, runtimeUrls: { ollama: baseUrl } });
    await expect(gateway.chatCompletion({ model: "boom", messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 500,
    });
  });

  it("proxies a streamed response chunk-for-chunk", async () => {
    await models.register({ name: "llama3", runtime: "ollama", state: "available" });
    const gateway = new AiGatewayService({ models, runtimeUrls: { ollama: baseUrl } });
    const chunks: string[] = [];
    await gateway.streamChatCompletion({ model: "llama3", messages: [{ role: "user", content: "hi" }], stream: true }, (c) =>
      chunks.push(c),
    );
    const combined = chunks.join("");
    expect(combined).toContain('"Hel"');
    expect(combined).toContain('"lo"');
    expect(combined).toContain("[DONE]");
  });
});
