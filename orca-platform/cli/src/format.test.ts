import { describe, expect, it } from "vitest";
import { bytesToHuman, table } from "./format.js";

describe("table", () => {
  it("renders an aligned table with a header row", () => {
    const out = table([
      { id: "node_1", status: "online" },
      { id: "node_2", status: "offline" },
    ]);
    const lines = out.split("\n");
    expect(lines[0].trimEnd()).toBe("ID      STATUS");
    expect(lines[1]).toContain("node_1");
    expect(lines[2]).toContain("node_2");
  });

  it("returns a placeholder for an empty list", () => {
    expect(table([])).toBe("(none)");
  });
});

describe("bytesToHuman", () => {
  it("formats bytes into human-readable units", () => {
    expect(bytesToHuman(0)).toBe("0.0 B");
    expect(bytesToHuman(1536)).toBe("1.5 KB");
    expect(bytesToHuman(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("handles undefined", () => {
    expect(bytesToHuman(undefined)).toBe("-");
  });
});
