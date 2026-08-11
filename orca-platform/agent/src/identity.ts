import { join } from "node:path";
import { JsonStore, generateId } from "@orca/shared";

export interface NodeIdentity {
  nodeId: string;
}

/**
 * A node's id must survive process restarts (otherwise Control would treat
 * every restart as a brand new machine). Persisted once, reused forever.
 */
export async function loadOrCreateIdentity(dataDir: string): Promise<NodeIdentity> {
  const store = new JsonStore<NodeIdentity>(join(dataDir, "identity.json"), { nodeId: generateId("node") });
  return store.load();
}
