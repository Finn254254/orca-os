import { loadApiConfig } from "./config.js";
import { createApiServer } from "./server.js";

const config = loadApiConfig();
const handle = await createApiServer(config);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    handle.logger.info({ signal }, "shutting down orca-api");
    await handle.close();
    process.exit(0);
  });
}
