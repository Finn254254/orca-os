export interface SseParseResult {
  /** Text deltas extracted from this chunk (OpenAI-style `choices[0].delta.content` or `.message.content`). */
  texts: string[];
  /** Unparsed trailing partial line to prepend to the next chunk. */
  remainder: string;
  /** Whether a `data: [DONE]` terminator was seen in this chunk. */
  done: boolean;
}

/**
 * Incrementally extracts text deltas from an OpenAI-compatible SSE stream.
 * Pure and stateless aside from the caller-held `buffer` (the previous
 * call's `remainder`) — used by the conversations route to accumulate the
 * full reply for persistence while still forwarding raw bytes to the
 * client untouched (see AiGatewayService.streamChatCompletion).
 */
export function parseSseChunk(buffer: string, chunk: string): SseParseResult {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";
  const texts: string[] = [];
  let done = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const parsed = JSON.parse(data);
      const content = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
      if (typeof content === "string") texts.push(content);
    } catch {
      // Malformed/partial line — ignore rather than throw; the stream keeps flowing.
    }
  }

  return { texts, remainder, done };
}
