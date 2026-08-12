import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeAdapter, RuntimeModelInfo } from "./adapters/types.js";
import { ModelService } from "./modelService.js";
import { ModelStore } from "./store.js";

class FakeAdapter implements RuntimeAdapter {
  readonly runtime = "ollama" as const;
  available: RuntimeModelInfo[] = [];
  shouldFail = false;
  deletedNames: string[] = [];

  async listAvailable() {
    return this.available;
  }

  async pullModel(name: string, onProgress?: (pct: number) => void) {
    onProgress?.(50);
    if (this.shouldFail) throw new Error("simulated pull failure");
    onProgress?.(100);
  }

  async deleteModel(name: string) {
    this.deletedNames.push(name);
  }
}

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 20));
}

describe("ModelService", () => {
  let dir: string;
  let store: ModelStore;
  let adapter: FakeAdapter;
  let service: ModelService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-model-service-"));
    store = new ModelStore(dir);
    await store.init();
    adapter = new FakeAdapter();
    service = new ModelService({ store, adapters: { ollama: adapter } });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("rejects pulling from an unconfigured runtime", async () => {
    await expect(service.pullModel("llamacpp", "x")).rejects.toThrow(/no adapter configured/);
  });

  it("returns a downloading record immediately and transitions to available", async () => {
    const model = await service.pullModel("ollama", "llama3");
    expect(model.state).toBe("downloading");

    await flushMicrotasks();
    const updated = service.getModel(model.id);
    expect(updated?.state).toBe("available");
    expect(updated?.downloadProgressPct).toBe(100);
  });

  it("marks a model as errored when the adapter's pull fails", async () => {
    adapter.shouldFail = true;
    const model = await service.pullModel("ollama", "broken-model");
    await flushMicrotasks();
    const updated = service.getModel(model.id);
    expect(updated?.state).toBe("error");
    expect(updated?.metadata?.error).toMatch(/simulated pull failure/);
  });

  it("deletes a model via its adapter and removes it from the registry", async () => {
    const model = await service.pullModel("ollama", "llama3");
    await flushMicrotasks();
    expect(await service.deleteModel(model.id)).toBe(true);
    expect(adapter.deletedNames).toContain("llama3");
    expect(service.getModel(model.id)).toBeUndefined();
  });

  it("returns false deleting an unknown model", async () => {
    expect(await service.deleteModel("model_nope")).toBe(false);
  });

  it("syncs the registry from what the runtime reports", async () => {
    adapter.available = [{ name: "llama3", sizeBytes: 123, format: "gguf" }];
    const synced = await service.refreshFromRuntime("ollama");
    expect(synced).toHaveLength(1);
    expect(synced[0].state).toBe("available");
    expect(service.listModels()).toHaveLength(1);
  });
});
