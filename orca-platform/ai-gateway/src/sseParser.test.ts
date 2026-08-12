import { describe, expect, it } from "vitest";
import { parseSseChunk } from "./sseParser.js";

describe("parseSseChunk", () => {
  it("extracts a single delta text", () => {
    const result = parseSseChunk("", 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
    expect(result.texts).toEqual(["Hi"]);
    expect(result.done).toBe(false);
  });

  it("detects the [DONE] terminator", () => {
    const result = parseSseChunk("", "data: [DONE]\n\n");
    expect(result.texts).toEqual([]);
    expect(result.done).toBe(true);
  });

  it("carries a partial trailing line into the remainder", () => {
    const result = parseSseChunk("", 'data: {"choices":[{"delta":{"content":"Hi"}}]}\ndata: {"choic');
    expect(result.texts).toEqual(["Hi"]);
    expect(result.remainder).toBe('data: {"choic');
  });

  it("resumes parsing correctly once the remainder is completed by the next chunk", () => {
    const first = parseSseChunk("", 'data: {"choices":[{"delta":{"content":"Hi"}}]}\ndata: {"choic');
    const second = parseSseChunk(first.remainder, 'es":[{"delta":{"content":" there"}}]}\n\n');
    expect(second.texts).toEqual([" there"]);
  });

  it("ignores non-data lines and malformed JSON without throwing", () => {
    const result = parseSseChunk("", 'event: ping\ndata: not-json\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    expect(result.texts).toEqual(["ok"]);
  });

  it("falls back to message.content for a non-streaming-shaped chunk", () => {
    const result = parseSseChunk("", 'data: {"choices":[{"message":{"content":"final"}}]}\n\n');
    expect(result.texts).toEqual(["final"]);
  });

  it("accumulates multiple deltas across several chunks", () => {
    let buffer = "";
    let full = "";
    for (const piece of ["Hel", "lo", " world"]) {
      const result = parseSseChunk(buffer, `data: {"choices":[{"delta":{"content":"${piece}"}}]}\n\n`);
      buffer = result.remainder;
      full += result.texts.join("");
    }
    expect(full).toBe("Hello world");
  });
});
