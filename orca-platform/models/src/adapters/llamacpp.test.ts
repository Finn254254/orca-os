import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlamaCppAdapter } from "./llamacpp.js";

describe("LlamaCppAdapter", () => {
  let dir: string;
  let adapter: LlamaCppAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-llamacpp-"));
    adapter = new LlamaCppAdapter(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("returns an empty list when the models directory does not exist yet", async () => {
    const missing = new LlamaCppAdapter(join(dir, "does-not-exist"));
    expect(await missing.listAvailable()).toEqual([]);
  });

  it("lists .gguf files with their real size and ignores everything else", async () => {
    await writeFile(join(dir, "model-a.gguf"), Buffer.alloc(1024));
    await writeFile(join(dir, "model-b.gguf"), Buffer.alloc(2048));
    await writeFile(join(dir, "readme.txt"), "not a model");

    const list = await adapter.listAvailable();
    const names = list.map((m) => m.name).sort();
    expect(names).toEqual(["model-a.gguf", "model-b.gguf"]);
    expect(list.find((m) => m.name === "model-b.gguf")?.sizeBytes).toBe(2048);
  });

  it("rejects pullModel — llama.cpp has no remote pull", async () => {
    await expect(adapter.pullModel("anything")).rejects.toThrow(/does not support remote pulls/);
  });

  it("deletes a model file for real", async () => {
    const path = join(dir, "to-delete.gguf");
    await writeFile(path, Buffer.alloc(10));
    await adapter.deleteModel("to-delete.gguf");
    expect(await adapter.listAvailable()).toEqual([]);
  });
});
