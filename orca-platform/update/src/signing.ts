import { createHmac, timingSafeEqual } from "node:crypto";
import type { UpdateManifest } from "@orca/shared";

/**
 * HMAC-SHA256 signing over an update manifest's content fields. An MVP
 * tamper-evidence mechanism (shared-secret, single signer) rather than a
 * full asymmetric PKI — sufficient for one cluster operator publishing
 * releases to their own cluster. Multi-party release signing (asymmetric
 * keys, so Control can verify without holding the signing secret) is
 * future work if Orca ever needs third-party-published releases.
 */
function canonicalPayload(manifest: Pick<UpdateManifest, "version" | "artifactUrl" | "checksum">): string {
  return `${manifest.version}|${manifest.artifactUrl}|${manifest.checksum}`;
}

export function signManifest(manifest: Pick<UpdateManifest, "version" | "artifactUrl" | "checksum">, signingKey: string): string {
  return createHmac("sha256", signingKey).update(canonicalPayload(manifest)).digest("hex");
}

export function verifyManifestSignature(manifest: UpdateManifest, signingKey: string): boolean {
  if (!manifest.signature) return false;
  const expected = signManifest(manifest, signingKey);
  const actual = Buffer.from(manifest.signature);
  const expectedBuf = Buffer.from(expected);
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}
