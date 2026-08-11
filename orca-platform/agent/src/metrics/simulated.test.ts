import { describe, expect, it } from "vitest";
import { NodeCapabilitiesSchema, NodeMetricsSchema, ServiceStatusSchema } from "@orca/shared";
import { SimulatedMetricsProvider } from "./simulated.js";

describe("SimulatedMetricsProvider", () => {
  it("produces schema-valid capabilities, metrics, and services", async () => {
    const provider = new SimulatedMetricsProvider({ hasGpu: true });
    const capabilities = await provider.collectCapabilities();
    expect(() => NodeCapabilitiesSchema.parse(capabilities)).not.toThrow();
    expect(capabilities.gpus).toHaveLength(1);

    const metrics = await provider.collectMetrics();
    expect(() => NodeMetricsSchema.parse(metrics)).not.toThrow();
    expect(metrics.ramUsedBytes).toBeLessThanOrEqual(metrics.ramTotalBytes!);

    const services = await provider.collectServices();
    for (const s of services) expect(() => ServiceStatusSchema.parse(s)).not.toThrow();
  });

  it("keeps ram usage within plausible bounds across repeated samples", async () => {
    const provider = new SimulatedMetricsProvider({ ramTotalBytes: 1000 });
    for (let i = 0; i < 25; i++) {
      const metrics = await provider.collectMetrics();
      expect(metrics.ramUsedBytes).toBeGreaterThanOrEqual(0);
      expect(metrics.ramUsedBytes).toBeLessThanOrEqual(1000);
    }
  });
});
