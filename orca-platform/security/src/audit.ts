import { join } from "node:path";
import { JsonStore, generateId, now, type AuditEvent } from "@orca/shared";

interface AuditState {
  events: AuditEvent[];
}

const MAX_EVENTS = 5000;

/** Durable audit log: who did what, when. Trimmed to the most recent MAX_EVENTS entries. */
export class AuditLog {
  private readonly store: JsonStore<AuditState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "audit.json"), { events: [] });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async record(input: { actor: string; action: string; target?: string; detail?: Record<string, unknown> }): Promise<AuditEvent> {
    const event: AuditEvent = { id: generateId("audit"), timestamp: now(), detail: {}, ...input };
    await this.store.mutate((s) => ({ events: [...s.events, event].slice(-MAX_EVENTS) }));
    return event;
  }

  list(limit = 200): AuditEvent[] {
    return [...this.store.get().events].reverse().slice(0, limit);
  }

  /** Waits for every write enqueued so far to be durably persisted. Call before process shutdown. */
  async flush(): Promise<void> {
    await this.store.flush();
  }
}
