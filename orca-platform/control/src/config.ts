import { join } from "node:path";

export interface ControlConfig {
  port: number;
  dataDir: string;
  clusterToken: string;
  clusterName: string;
}

export function loadControlConfig(): ControlConfig {
  const dataDir = process.env.ORCA_DATA_DIR ?? join(process.cwd(), "data");
  const clusterToken = process.env.ORCA_CLUSTER_TOKEN;
  if (!clusterToken) {
    // Never hard-code a secret; require an explicit token so mesh auth is meaningful.
    throw new Error(
      "ORCA_CLUSTER_TOKEN is not set. Set it to a shared secret used to authenticate Orca Agents (see orca-platform/docs/SECURITY.md).",
    );
  }
  return {
    port: Number(process.env.ORCA_CONTROL_PORT ?? 7000),
    dataDir,
    clusterToken,
    clusterName: process.env.ORCA_CLUSTER_NAME ?? "orca-cluster",
  };
}
