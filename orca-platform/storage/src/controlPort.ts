import type { NodeRecord } from "@orca/shared";

/** Storage only needs read access to node metrics (disks come along with each node's lastMetrics). */
export interface ControlPort {
  listNodes(): Promise<NodeRecord[]>;
}
