import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearSession, getStoredUser, getToken, listAvailableModels, login, sendMessage, storeSession } from "./api.js";

describe("session storage", () => {
  afterEach(() => {
    clearSession();
  });

  it("round-trips a stored session", () => {
    storeSession("tok123", { id: "user_1", username: "alice", role: "admin" });
    expect(getToken()).toBe("tok123");
    expect(getStoredUser()).toEqual({ id: "user_1", username: "alice", role: "admin" });
  });

  it("clears the session", () => {
    storeSession("tok123", { id: "user_1", username: "alice", role: "admin" });
    clearSession();
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });
});

describe("login", () => {
  beforeEach(() => {
    clearSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it("stores the session on success", async () => {
    const user = { id: "user_1", username: "alice", role: "admin" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: "tok123", user }),
      }),
    );
    const result = await login("alice", "pw");
    expect(result).toEqual(user);
    expect(getToken()).toBe("tok123");
  });

  it("throws ApiError with the server's message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => JSON.stringify({ error: "invalid credentials" }),
      }),
    );
    await expect(login("alice", "wrong")).rejects.toThrow(ApiError);
  });
});

describe("listAvailableModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps the OpenAI-style list envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: [{ id: "llama3", object: "model", created: 0, owned_by: "ollama" }] }),
      }),
    );
    const models = await listAvailableModels();
    expect(models).toEqual([{ id: "llama3", object: "model", created: 0, owned_by: "ollama" }]);
  });
});

describe("sendMessage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("streams deltas and resolves with the full accumulated reply", async () => {
    const encoder = new TextEncoder();
    const chunks = ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', 'data: {"choices":[{"delta":{"content":", world"}}]}\n\n', "data: [DONE]\n\n"];
    let i = 0;
    const reader = {
      read: async () => {
        if (i >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: encoder.encode(chunks[i++]) };
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
      }),
    );

    const deltas: string[] = [];
    const full = await sendMessage("conv_1", "hi", (d) => deltas.push(d));
    expect(deltas).toEqual(["Hello", ", world"]);
    expect(full).toBe("Hello, world");
  });
});
