import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, agentConfigs, clearSession, getStoredUser, getToken, login, storeSession } from "./api.js";

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
  beforeEach(() => clearSession());
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

describe("agentConfigs.run", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts input to the run endpoint and returns the run", async () => {
    const run = { id: "run_1", status: "succeeded", output: "hi" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => run });
    vi.stubGlobal("fetch", fetchMock);

    const result = await agentConfigs.run("agentcfg_1", "hello");
    expect(result).toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/studio/agents/agentcfg_1/run",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ input: "hello" }) }),
    );
  });
});
