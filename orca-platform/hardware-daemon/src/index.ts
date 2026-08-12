import { createHardwareDaemon } from "./server.js";
import { SimulatedHardwareBackend } from "./simulatedBackend.js";

export * from "./server.js";
export * from "./simulatedBackend.js";
export * from "./types.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.ORCA_HW_PORT ?? 9090);
  const backend = new SimulatedHardwareBackend();
  const handle = await createHardwareDaemon(port, backend);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      handle.logger.info({ signal }, "shutting down orca-hardware-daemon");
      await handle.close();
      process.exit(0);
    });
  }
}
