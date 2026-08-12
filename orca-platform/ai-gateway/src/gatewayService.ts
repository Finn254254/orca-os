import type { ModelRuntime } from "@orca/shared";
import type { ModelStore } from "@orca/models";
import { GatewayError, type ChatCompletionRequest, type ChatCompletionResponse, type OpenAiModelListEntry } from "./types.js";

export interface AiGatewayOptions {
  models: ModelStore;
  runtimeUrls: Partial<Record<ModelRuntime, string>>;
}

/**
 * Unified inference API: applications ask for a model by name without
 * needing to know which runtime/node hosts it. Both Ollama and llama.cpp's
 * server expose an OpenAI-compatible `/v1/chat/completions` endpoint (a
 * documented feature of each), so routing is "look up which runtime this
 * model belongs to, forward to that runtime's OpenAI-compatible endpoint" —
 * genuinely simple rather than reimplementing inference proxying from
 * scratch. See ai-gateway/README.md for the current single-endpoint-per-
 * runtime scope limitation (same one Model Manager documents).
 */
export class AiGatewayService {
  constructor(private readonly options: AiGatewayOptions) {}

  listModels(): OpenAiModelListEntry[] {
    return this.options.models
      .listModels()
      .filter((m) => m.state === "available" || m.state === "loaded")
      .map((m) => ({
        id: m.name,
        object: "model" as const,
        created: Math.floor(new Date(m.createdAt).getTime() / 1000),
        owned_by: m.runtime,
      }));
  }

  private resolveBaseUrl(modelName: string): { baseUrl: string; runtime: ModelRuntime } {
    const model = this.options.models.listModels().find((m) => m.name === modelName);
    if (!model) throw new GatewayError(404, `model "${modelName}" is not registered — pull it first`);
    const baseUrl = this.options.runtimeUrls[model.runtime];
    if (!baseUrl) throw new GatewayError(503, `no endpoint configured for runtime "${model.runtime}"`);
    return { baseUrl, runtime: model.runtime };
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { baseUrl } = this.resolveBaseUrl(request.model);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: false }),
      });
    } catch (err) {
      throw new GatewayError(502, `could not reach runtime: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GatewayError(res.status, body || `runtime returned ${res.status}`);
    }
    return (await res.json()) as ChatCompletionResponse;
  }

  /** Proxies the upstream runtime's SSE stream byte-for-byte to `onChunk`. */
  async streamChatCompletion(request: ChatCompletionRequest, onChunk: (chunk: string) => void): Promise<void> {
    const { baseUrl } = this.resolveBaseUrl(request.model);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
      });
    } catch (err) {
      throw new GatewayError(502, `could not reach runtime: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok || !res.body) {
      const body = res.body ? await res.text().catch(() => "") : "";
      throw new GatewayError(res.status, body || `runtime returned ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  }
}
