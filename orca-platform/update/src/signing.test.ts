import { describe, expect, it } from "vitest";
import { signManifest, verifyManifestSignature } from "./signing.js";

describe("manifest signing", () => {
  const base = { version: "1.0.0", artifactUrl: "https://example.invalid/img", checksum: "abc123" };

  it("verifies a correctly signed manifest", () => {
    const signature = signManifest(base, "secret-key");
    expect(verifyManifestSignature({ ...base, signature, createdAt: new Date().toISOString() }, "secret-key")).toBe(true);
  });

  it("rejects a manifest signed with a different key", () => {
    const signature = signManifest(base, "secret-key");
    expect(verifyManifestSignature({ ...base, signature, createdAt: new Date().toISOString() }, "wrong-key")).toBe(false);
  });

  it("rejects a manifest whose content was tampered with after signing", () => {
    const signature = signManifest(base, "secret-key");
    const tampered = { ...base, artifactUrl: "https://evil.invalid/img", signature, createdAt: new Date().toISOString() };
    expect(verifyManifestSignature(tampered, "secret-key")).toBe(false);
  });

  it("rejects a manifest with no signature", () => {
    expect(verifyManifestSignature({ ...base, createdAt: new Date().toISOString() }, "secret-key")).toBe(false);
  });
});
