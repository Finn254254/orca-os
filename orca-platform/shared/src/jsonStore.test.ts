import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "./jsonStore.js";

describe("JsonStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-jsonstore-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the default value when no file exists yet", async () => {
    const store = new JsonStore(join(dir, "state.json"), { count: 0 });
    const value = await store.load();
    expect(value).toEqual({ count: 0 });
  });

  it("persists and reloads values across store instances", async () => {
    const file = join(dir, "state.json");
    const store1 = new JsonStore(file, { count: 0 });
    await store1.mutate((v) => ({ count: v.count + 1 }));

    const store2 = new JsonStore<{ count: number }>(file, { count: -1 });
    const reloaded = await store2.load();
    expect(reloaded).toEqual({ count: 1 });
  });

  it("serializes concurrent mutations without losing writes", async () => {
    const store = new JsonStore(join(dir, "state.json"), { count: 0 });
    await store.load();
    await Promise.all(Array.from({ length: 20 }, () => store.mutate((v) => ({ count: v.count + 1 }))));
    expect(store.get().count).toBe(20);
  });
});
