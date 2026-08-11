import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, ApiClientError } from "./apiClient.js";

describe("ApiClient", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuthHeader: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastAuthHeader = req.headers.authorization;
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ hello: "world" }));
        return;
      }
      if (req.url === "/error") {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("sends the bearer token when provided", async () => {
    const client = new ApiClient(baseUrl, "tok123");
    const result = await client.get<{ hello: string }>("/ok");
    expect(result.hello).toBe("world");
    expect(lastAuthHeader).toBe("Bearer tok123");
  });

  it("omits the auth header when no token is set", async () => {
    const client = new ApiClient(baseUrl);
    await client.get("/ok");
    expect(lastAuthHeader).toBeUndefined();
  });

  it("surfaces the server's error message and status", async () => {
    const client = new ApiClient(baseUrl);
    await expect(client.get("/error")).rejects.toThrow("forbidden");
    try {
      await client.get("/error");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(403);
    }
  });
});
