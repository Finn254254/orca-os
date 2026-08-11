import type { NodeCapabilities, NodeMetrics, ServiceStatus } from "@orca/shared";

export interface MetricsProvider {
  collectCapabilities(): Promise<NodeCapabilities>;
  collectMetrics(): Promise<NodeMetrics>;
  collectServices(): Promise<ServiceStatus[]>;
}
