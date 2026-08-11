import { describe, expect, it } from "vitest";
import { generateSecret, hashPassword, signToken, verifyToken } from "./auth.js";

describe("auth tokens", () => {
  it("round-trips a signed token", () => {
    const secret = generateSecret();
    const token = signToken({ nodeId: "node_1" }, secret);
    const payload = verifyToken<{ nodeId: string }>(token, secret);
    expect(payload?.nodeId).toBe("node_1");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signToken({ nodeId: "node_1" }, generateSecret());
    const payload = verifyToken(token, generateSecret());
    expect(payload).toBeNull();
  });

  it("rejects an expired token", async () => {
    const secret = generateSecret();
    const token = signToken({ nodeId: "node_1" }, secret, -1);
    const payload = verifyToken(token, secret);
    expect(payload).toBeNull();
  });

  it("hashes passwords deterministically for a given salt", () => {
    const a = hashPassword("hunter2", "salt");
    const b = hashPassword("hunter2", "salt");
    expect(a).toBe(b);
    expect(a).not.toBe("hunter2");
  });
});
