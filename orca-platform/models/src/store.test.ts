import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelStore } from "./store.js";

describe("ModelStore", () => {
  let dir: string;
  let store: ModelStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-models-"));
    store = new ModelStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("registers a model and lists it", async () => {
    const model = await store.register({ name: "llama3", runtime: "ollama" });
    expect(model.state).toBe("not_downloaded");
    expect(store.listModels()).toHaveLength(1);
  });

  it("re-registering the same name+runtime updates the existing record instead of duplicating", async () => {
    const first = await store.register({ name: "llama3", runtime: "ollama", state: "not_downloaded" });
    const second = await store.register({ name: "llama3", runtime: "ollama", state: "available" });
    expect(second.id).toBe(first.id);
    expect(store.listModels()).toHaveLength(1);
    expect(store.getModel(first.id)?.state).toBe("available");
  });

  it("treats the same name under different runtimes as distinct models", async () => {
    await store.register({ name: "llama3", runtime: "ollama" });
    await store.register({ name: "llama3", runtime: "llamacpp" });
    expect(store.listModels()).toHaveLength(2);
  });

  it("updates and deletes a model", async () => {
    const model = await store.register({ name: "llama3", runtime: "ollama" });
    await store.updateModel(model.id, { downloadProgressPct: 50 });
    expect(store.getModel(model.id)?.downloadProgressPct).toBe(50);

    expect(await store.deleteModel(model.id)).toBe(true);
    expect(store.getModel(model.id)).toBeUndefined();
    expect(await store.deleteModel(model.id)).toBe(false);
  });
});
