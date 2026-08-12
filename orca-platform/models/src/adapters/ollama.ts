import type { RuntimeAdapter, RuntimeModelInfo } from "./types.js";

interface OllamaTagsResponse {
  models: { name: string; size?: number; details?: { format?: string } }[];
}

interface OllamaPullProgressLine {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

/**
 * Adapter for Ollama's REST API (default http://localhost:11434), per
 * Ollama's documented endpoints: GET /api/tags, POST /api/pull (streaming
 * NDJSON progress), DELETE /api/delete.
 *
 * NOTE: implemented against Ollama's public API documentation — this
 * environment had no way to run a live Ollama instance to verify against,
 * so treat this as unverified-against-a-live-server until someone runs it
 * against a real `ollama serve`. See orca-platform/docs/PROGRESS.md.
 */
export class OllamaAdapter implements RuntimeAdapter {
  readonly runtime = "ollama" as const;

  constructor(private readonly baseUrl: string = process.env.ORCA_OLLAMA_URL ?? "http://localhost:11434") {}

  async listAvailable(): Promise<RuntimeModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`ollama /api/tags returned ${res.status}`);
    const data = (await res.json()) as OllamaTagsResponse;
    return data.models.map((m) => ({ name: m.name, sizeBytes: m.size, format: m.details?.format }));
  }

  async pullModel(name: string, onProgress?: (pct: number) => void): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`ollama /api/pull returned ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line) as OllamaPullProgressLine;
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.total && parsed.completed !== undefined) {
          onProgress?.((parsed.completed / parsed.total) * 100);
        }
      }
    }
    onProgress?.(100);
  }

  async deleteModel(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`ollama /api/delete returned ${res.status}`);
  }
}
