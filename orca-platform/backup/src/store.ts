import { join } from "node:path";
import { JsonStore, generateId, now } from "@orca/shared";
import type { BackupJob, BackupSchedule, RestoreRecord } from "./types.js";

interface BackupState {
  jobs: Record<string, BackupJob>;
  schedules: Record<string, BackupSchedule>;
  restores: Record<string, RestoreRecord>;
}

export class BackupStore {
  private readonly store: JsonStore<BackupState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "backups.json"), { jobs: {}, schedules: {}, restores: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async createJob(input: Pick<BackupJob, "kind" | "targetId">): Promise<BackupJob> {
    const job: BackupJob = { id: generateId("backup"), state: "pending", createdAt: now(), ...input };
    await this.store.mutate((s) => ({ ...s, jobs: { ...s.jobs, [job.id]: job } }));
    return job;
  }

  async updateJob(id: string, patch: Partial<BackupJob>): Promise<BackupJob | undefined> {
    const state = await this.store.mutate((s) => {
      const job = s.jobs[id];
      if (!job) return s;
      return { ...s, jobs: { ...s.jobs, [id]: { ...job, ...patch } } };
    });
    return state.jobs[id];
  }

  listJobs(): BackupJob[] {
    return Object.values(this.store.get().jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(id: string): BackupJob | undefined {
    return this.store.get().jobs[id];
  }

  async createSchedule(input: Pick<BackupSchedule, "kind" | "targetId" | "intervalMs" | "enabled">): Promise<BackupSchedule> {
    const schedule: BackupSchedule = { id: generateId("sched"), createdAt: now(), ...input };
    await this.store.mutate((s) => ({ ...s, schedules: { ...s.schedules, [schedule.id]: schedule } }));
    return schedule;
  }

  listSchedules(): BackupSchedule[] {
    return Object.values(this.store.get().schedules).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateSchedule(id: string, patch: Partial<BackupSchedule>): Promise<BackupSchedule | undefined> {
    const state = await this.store.mutate((s) => {
      const schedule = s.schedules[id];
      if (!schedule) return s;
      return { ...s, schedules: { ...s.schedules, [id]: { ...schedule, ...patch } } };
    });
    return state.schedules[id];
  }

  async deleteSchedule(id: string): Promise<boolean> {
    if (!this.store.get().schedules[id]) return false;
    await this.store.mutate((s) => {
      const { [id]: _removed, ...rest } = s.schedules;
      return { ...s, schedules: rest };
    });
    return true;
  }

  async createRestore(input: Pick<RestoreRecord, "backupJobId" | "restoredBy" | "notes">): Promise<RestoreRecord> {
    const restore: RestoreRecord = { id: generateId("restore"), restoredAt: now(), ...input };
    await this.store.mutate((s) => ({ ...s, restores: { ...s.restores, [restore.id]: restore } }));
    return restore;
  }

  listRestores(): RestoreRecord[] {
    return Object.values(this.store.get().restores).sort((a, b) => b.restoredAt.localeCompare(a.restoredAt));
  }
}
