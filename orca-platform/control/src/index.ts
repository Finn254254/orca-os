import { loadControlConfig } from "./config.js";
import { createControlServer } from "./server.js";

const config = loadControlConfig();
const handle = await createControlServer(config);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    handle.logger.info({ signal }, "shutting down orca-control");
    await handle.close();
    process.exit(0);
  });
}
