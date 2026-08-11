import { createLogger } from "@orca/shared";
import { OrcaAgent } from "./agent.js";
import { loadAgentConfig } from "./config.js";
import { loadOrCreateIdentity } from "./identity.js";
import { RealMetricsProvider } from "./metrics/real.js";
import { SimulatedMetricsProvider } from "./metrics/simulated.js";

const logger = createLogger("orca-agent");
const config = loadAgentConfig();
const identity = await loadOrCreateIdentity(config.dataDir);

const metrics = config.simulated
  ? new SimulatedMetricsProvider({
      cpuCores: process.env.ORCA_SIM_CPU_CORES ? Number(process.env.ORCA_SIM_CPU_CORES) : undefined,
      ramTotalBytes: process.env.ORCA_SIM_RAM_BYTES ? Number(process.env.ORCA_SIM_RAM_BYTES) : undefined,
      hasGpu: process.env.ORCA_SIM_GPU === "1",
    })
  : new RealMetricsProvider((process.env.ORCA_WATCHED_SERVICES ?? "orcad").split(",").filter(Boolean));

const agent = new OrcaAgent({ config, nodeId: identity.nodeId, metrics, logger });
logger.info({ nodeId: identity.nodeId, name: config.nodeName, simulated: config.simulated }, "starting orca-agent");
await agent.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down orca-agent");
    agent.stop();
    process.exit(0);
  });
}
