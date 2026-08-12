import { join } from "node:path";
import { JsonStore, generateId, now, type JobRecord, type JobSpec, type JobState } from "@orca/shared";

interface ComputeState {
  jobs: Record<string, JobRecord>;
  // Internal bookkeeping (which Control command a running job is waiting on).
  // Not part of the public JobRecord schema.
  commandIdByJob: Record<string, string>;
}

export class JobStore {
  private readonly store: JsonStore<ComputeState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "jobs.json"), { jobs: {}, commandIdByJob: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async createJob(spec: JobSpec): Promise<JobRecord> {
    const job: JobRecord = {
      id: generateId("job"),
      spec,
      state: "queued",
      progressPct: 0,
      createdAt: now(),
      logs: [],
    };
    await this.store.mutate((s) => ({ ...s, jobs: { ...s.jobs, [job.id]: job } }));
    return job;
  }

  listJobs(): JobRecord[] {
    return Object.values(this.store.get().jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(id: string): JobRecord | undefined {
    return this.store.get().jobs[id];
  }

  async updateJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | undefined> {
    const state = await this.store.mutate((s) => {
      const job = s.jobs[id];
      if (!job) return s;
      return { ...s, jobs: { ...s.jobs, [id]: { ...job, ...patch } } };
    });
    return state.jobs[id];
  }

  async appendLog(id: string, line: string): Promise<void> {
    await this.store.mutate((s) => {
      const job = s.jobs[id];
      if (!job) return s;
      return { ...s, jobs: { ...s.jobs, [id]: { ...job, logs: [...job.logs, line] } } };
    });
  }

  async setCommand(jobId: string, commandId: string): Promise<void> {
    await this.store.mutate((s) => ({ ...s, commandIdByJob: { ...s.commandIdByJob, [jobId]: commandId } }));
  }

  getCommandId(jobId: string): string | undefined {
    return this.store.get().commandIdByJob[jobId];
  }

  async clearCommand(jobId: string): Promise<void> {
    await this.store.mutate((s) => {
      const { [jobId]: _removed, ...rest } = s.commandIdByJob;
      return { ...s, commandIdByJob: rest };
    });
  }

  listJobsInState(...states: JobState[]): JobRecord[] {
    return this.listJobs().filter((j) => states.includes(j.state));
  }
}
