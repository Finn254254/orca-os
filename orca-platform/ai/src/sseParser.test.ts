import { describe, expect, it } from "vitest";
import { parseSseChunk } from "./sseParser.js";

describe("parseSseChunk", () => {
  it("extracts delta content from a single complete chunk", () => {
    const result = parseSseChunk("", 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
    expect(result.texts).toEqual(["hi"]);
    expect(result.done).toBe(false);
  });

  it("detects [DONE]", () => {
    const result = parseSseChunk("", "data: [DONE]\n\n");
    expect(result.texts).toEqual([]);
    expect(result.done).toBe(true);
  });

  it("carries a partial line across two calls via the remainder buffer", () => {
    const first = parseSseChunk("", 'data: {"choices":[{"delta":{"content":"ab');
    expect(first.texts).toEqual([]);
    const second = parseSseChunk(first.remainder, 'c"}}]}\n\n');
    expect(second.texts).toEqual(["abc"]);
  });

  it("ignores malformed JSON without throwing", () => {
    const result = parseSseChunk("", "data: {not json}\n\n");
    expect(result.texts).toEqual([]);
  });

  it("accumulates multiple chunks", () => {
    let buffer = "";
    let acc = "";
    for (const chunk of ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', 'data: {"choices":[{"delta":{"content":", world"}}]}\n\n']) {
      const result = parseSseChunk(buffer, chunk);
      buffer = result.remainder;
      acc += result.texts.join("");
    }
    expect(acc).toBe("Hello, world");
  });
});
