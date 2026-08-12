import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeAdapter, RuntimeModelInfo } from "./types.js";

/**
 * Adapter for llama.cpp. Unlike Ollama, llama.cpp has no "pull a model over
 * the network" API — models are local GGUF files placed in a directory (by
 * the operator, or downloaded separately). This adapter lists/deletes those
 * files; `pullModel` is intentionally unsupported and says so.
 */
export class LlamaCppAdapter implements RuntimeAdapter {
  readonly runtime = "llamacpp" as const;

  constructor(private readonly modelsDir: string = process.env.ORCA_LLAMACPP_MODELS_DIR ?? "./models") {}

  async listAvailable(): Promise<RuntimeModelInfo[]> {
    let entries: string[];
    try {
      entries = await readdir(this.modelsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const ggufFiles = entries.filter((f) => f.endsWith(".gguf"));
    return Promise.all(
      ggufFiles.map(async (file) => {
        const stats = await stat(join(this.modelsDir, file));
        return { name: file, sizeBytes: stats.size, format: "gguf" };
      }),
    );
  }

  async pullModel(_name: string, _onProgress?: (pct: number) => void): Promise<void> {
    throw new Error(
      "llama.cpp does not support remote pulls — place the .gguf file in the configured models directory instead",
    );
  }

  async deleteModel(name: string): Promise<void> {
    await unlink(join(this.modelsDir, name));
  }
}
