import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "./audit.js";

describe("AuditLog", () => {
  let dir: string;
  let audit: AuditLog;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-audit-"));
    audit = new AuditLog(dir);
    await audit.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("records and lists events, newest first", async () => {
    await audit.record({ actor: "admin", action: "POST /api/v1/users" });
    await audit.record({ actor: "admin", action: "DELETE /api/v1/users/user_1" });
    const events = audit.list();
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe("DELETE /api/v1/users/user_1");
    expect(events[1].action).toBe("POST /api/v1/users");
  });

  it("respects the list limit", async () => {
    for (let i = 0; i < 5; i++) await audit.record({ actor: "admin", action: `action-${i}` });
    expect(audit.list(2)).toHaveLength(2);
  });

  it("persists across instances", async () => {
    await audit.record({ actor: "admin", action: "login" });
    const reloaded = new AuditLog(dir);
    await reloaded.init();
    expect(reloaded.list()).toHaveLength(1);
  });

  it("defaults detail to an empty object", async () => {
    const event = await audit.record({ actor: "admin", action: "login" });
    expect(event.detail).toEqual({});
  });
});
