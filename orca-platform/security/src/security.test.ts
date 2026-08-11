import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./tokens.js";
import { UserStore } from "./userStore.js";

describe("UserStore", () => {
  let dir: string;
  let store: UserStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-security-"));
    store = new UserStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("bootstraps an admin user only when no users exist", async () => {
    const admin = await store.bootstrapAdmin("admin", "hunter2");
    expect(admin?.role).toBe("admin");
    const second = await store.bootstrapAdmin("someone-else", "pw");
    expect(second).toBeUndefined();
    expect(store.listUsers()).toHaveLength(1);
  });

  it("never stores passwords in plaintext", async () => {
    await store.createUser("alice", "correct horse battery staple", "operator");
    const users = store.listUsers();
    expect(JSON.stringify(users)).not.toContain("correct horse battery staple");
  });

  it("verifies correct credentials and rejects incorrect ones", async () => {
    await store.createUser("bob", "s3cret", "viewer");
    expect(store.verifyCredentials("bob", "s3cret")?.username).toBe("bob");
    expect(store.verifyCredentials("bob", "wrong")).toBeUndefined();
    expect(store.verifyCredentials("nobody", "s3cret")).toBeUndefined();
  });

  it("rejects duplicate usernames", async () => {
    await store.createUser("carol", "pw1", "viewer");
    await expect(store.createUser("carol", "pw2", "viewer")).rejects.toThrow();
  });

  it("deletes users", async () => {
    const user = await store.createUser("dave", "pw", "viewer");
    expect(await store.deleteUser(user.id)).toBe(true);
    expect(store.getUser(user.id)).toBeUndefined();
    expect(await store.deleteUser(user.id)).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips and expires", () => {
    const secret = "test-secret";
    const user = { id: "user_1", username: "alice", role: "admin" as const, createdAt: new Date().toISOString() };
    const token = createSessionToken(user, secret, 1000);
    const payload = verifySessionToken(token, secret);
    expect(payload?.userId).toBe("user_1");

    const expired = createSessionToken(user, secret, -1);
    expect(verifySessionToken(expired, secret)).toBeNull();

    expect(verifySessionToken(token, "wrong-secret")).toBeNull();
  });
});
