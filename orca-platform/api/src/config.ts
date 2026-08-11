import { join } from "node:path";

export interface ApiConfig {
  port: number;
  controlUrl: string;
  dataDir: string;
  sessionSecret: string;
  pollIntervalMs: number;
  bootstrapAdminUsername?: string;
  bootstrapAdminPassword?: string;
}

export function loadApiConfig(): ApiConfig {
  const sessionSecret = process.env.ORCA_SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error(
      "ORCA_SESSION_SECRET is not set. Set it to a random secret used to sign user session tokens (see orca-platform/docs/SECURITY.md).",
    );
  }
  return {
    port: Number(process.env.ORCA_API_PORT ?? 8080),
    controlUrl: process.env.ORCA_CONTROL_URL ?? "http://localhost:7000",
    dataDir: process.env.ORCA_DATA_DIR ?? join(process.cwd(), "data"),
    sessionSecret,
    pollIntervalMs: Number(process.env.ORCA_API_POLL_INTERVAL_MS ?? 1000),
    bootstrapAdminUsername: process.env.ORCA_ADMIN_USERNAME,
    bootstrapAdminPassword: process.env.ORCA_ADMIN_PASSWORD,
  };
}
