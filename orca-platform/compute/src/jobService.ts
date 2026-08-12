import { now, type JobRecord, type JobSpec } from "@orca/shared";
import { selectNode } from "@orca/scheduler";
import type { ControlPort } from "./controlPort.js";
import type { JobStore } from "./store.js";

export interface JobServiceOptions {
  store: JobStore;
  control: ControlPort;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Orchestrates the compute job lifecycle: submit -> schedule -> dispatch to
 * a node via Orca Control -> poll for completion -> record result/logs.
 * Jobs run on a single node today (per Phase 9 scope); JobSpec already
 * carries targetGroup/requiredCapabilities so multi-node workloads can be
 * layered on without a schema change later.
 */
export class JobService {
  private readonly store: JobStore;
  private readonly control: ControlPort;
  private readonly log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

  constructor(options: JobServiceOptions) {
    this.store = options.store;
    this.control = options.control;
    this.log = options.logger ?? { info: () => undefined, warn: () => undefined };
  }

  async submitJob(spec: JobSpec): Promise<JobRecord> {
    const job = await this.store.createJob(spec);
    await this.scheduleAndDispatch(job.id);
    return (await this.store.getJob(job.id)) ?? job;
  }

  private async scheduleAndDispatch(jobId: string): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) return;

    const nodes = await this.control.listNodes();
    const result = selectNode(nodes, job.spec);

    if (!result.ok) {
      await this.store.updateJob(jobId, {
        state: "failed",
        failureReason: result.failure.reason,
        completedAt: now(),
        logs: [...job.logs, `scheduling failed: ${result.failure.reason}`],
      });
      return;
    }

    await this.store.updateJob(jobId, {
      state: "scheduled",
      assignedNodeId: result.decision.nodeId,
      schedulingReason: result.decision.reason,
      logs: [...job.logs, result.decision.reason],
    });

    const command = await this.control.createCommand(result.decision.nodeId, "run_job", {
      command: job.spec.command ?? [],
      workload: job.spec.workload,
    });
    await this.store.setCommand(jobId, command.id);
    await this.store.updateJob(jobId, { state: "running", startedAt: now() });
    this.log.info({ jobId, nodeId: result.decision.nodeId, commandId: command.id }, "job dispatched");
  }

  /** Call periodically; advances any job whose dispatched command has completed. */
  async pollOnce(): Promise<void> {
    for (const job of this.store.listJobsInState("running")) {
      const commandId = this.store.getCommandId(job.id);
      if (!commandId) continue;
      let command;
      try {
        command = await this.control.getCommand(commandId);
      } catch (err) {
        this.log.warn({ jobId: job.id, commandId, err }, "failed to poll job command status");
        continue;
      }
      if (command.status === "succeeded") {
        await this.store.updateJob(job.id, {
          state: "succeeded",
          progressPct: 100,
          completedAt: now(),
          result: command.result,
          logs: [...job.logs, "job completed successfully"],
        });
        await this.store.clearCommand(job.id);
      } else if (command.status === "failed" || command.status === "timeout") {
        await this.store.updateJob(job.id, {
          state: "failed",
          completedAt: now(),
          failureReason: command.error ?? `command ${command.status}`,
          logs: [...job.logs, `job failed: ${command.error ?? command.status}`],
        });
        await this.store.clearCommand(job.id);
      }
    }
  }

  async cancelJob(jobId: string): Promise<JobRecord | undefined> {
    const job = this.store.getJob(jobId);
    if (!job) return undefined;
    if (job.state === "succeeded" || job.state === "failed" || job.state === "cancelled") return job;
    // MVP limitation: there is no in-flight cancellation command yet, so a
    // "running" job is marked cancelled here but may still finish executing
    // on the node; its eventual result is simply not applied once cancelled.
    await this.store.clearCommand(jobId);
    return this.store.updateJob(jobId, {
      state: "cancelled",
      completedAt: now(),
      logs: [...job.logs, "job cancelled by user"],
    });
  }

  listJobs(): JobRecord[] {
    return this.store.listJobs();
  }

  getJob(id: string): JobRecord | undefined {
    return this.store.getJob(id);
  }
}
