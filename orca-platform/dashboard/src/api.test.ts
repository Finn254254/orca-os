import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearSession, getStoredUser, getToken, login, storeSession } from "./api.js";

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
    await expect(login("alice", "wrong")).rejects.toThrow("invalid credentials");
  });
});
