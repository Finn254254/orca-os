// Client-side copy of @orca/ai-gateway's parseSseChunk. Duplicated rather
// than imported: that package's entry point pulls in Express (a Node-only
// dependency chain with no place in a browser bundle), so a tiny, pure
// function is copied here instead of adding a server package as a frontend
// dependency. Keep in sync with ai-gateway/src/sseParser.ts if it changes.
export interface SseParseResult {
  texts: string[];
  remainder: string;
  done: boolean;
}

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
