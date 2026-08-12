export interface RuntimeModelInfo {
  name: string;
  sizeBytes?: number;
  format?: string;
}

/**
 * Common surface Orca Model Manager needs from a local inference runtime.
 * Orca does not implement its own inference engine — see the build
 * instructions' explicit guidance — it adapts existing runtimes instead.
 */
export interface RuntimeAdapter {
  readonly runtime: "ollama" | "llamacpp";
  listAvailable(): Promise<RuntimeModelInfo[]>;
  pullModel(name: string, onProgress?: (pct: number) => void): Promise<void>;
  deleteModel(name: string): Promise<void>;
}
