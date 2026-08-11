import { homedir } from "node:os";
import { join } from "node:path";
import { JsonStore } from "@orca/shared";

export interface CliSession {
  apiUrl?: string;
  token?: string;
  username?: string;
}

function configDir(): string {
  return process.env.ORCA_CLI_CONFIG_DIR ?? join(homedir(), ".orca");
}

function sessionStore(): JsonStore<CliSession> {
  return new JsonStore<CliSession>(join(configDir(), "cli-session.json"), {});
}

export async function loadSession(): Promise<CliSession> {
  return sessionStore().load();
}

export async function saveSession(session: CliSession): Promise<void> {
  await sessionStore().save(session);
}

export async function clearSession(): Promise<void> {
  await sessionStore().save({});
}

/** Resolution order: explicit CLI flag > env var > saved session > default. */
export async function resolveApiUrl(flag?: string): Promise<string> {
  if (flag) return flag;
  if (process.env.ORCA_API_URL) return process.env.ORCA_API_URL;
  const session = await loadSession();
  return session.apiUrl ?? "http://localhost:8080";
}

export async function resolveToken(flag?: string): Promise<string | undefined> {
  if (flag) return flag;
  if (process.env.ORCA_API_TOKEN) return process.env.ORCA_API_TOKEN;
  const session = await loadSession();
  return session.token;
}
