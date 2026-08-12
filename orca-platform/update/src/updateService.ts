import { now, type NodeUpdateStatus, type Rollout, type UpdateManifest } from "@orca/shared";
import type { ControlPort } from "./controlPort.js";
import { signManifest, verifyManifestSignature } from "./signing.js";
import type { UpdateStore } from "./store.js";

export interface UpdateServiceOptions {
  store: UpdateStore;
  control: ControlPort;
  signingKey?: string;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Cluster-wide update management. Publishes signed manifests, rolls them
 * out to nodes (all-at-once or staged), tracks per-node status, and
 * supports rollback. The actual OS installation mechanism is Orca OS's
 * (see orca-platform/docs/OS_INTEGRATION.md) — this dispatches
 * `apply_update`/`rollback_update` commands through Orca Control the same
 * way Compute dispatches `run_job`, and the agent's installer adapter is
 * pluggable behind that.
 */
export class UpdateService {
  private readonly store: UpdateStore;
  private readonly control: ControlPort;
  private readonly signingKey?: string;
  private readonly log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

  constructor(options: UpdateServiceOptions) {
    this.store = options.store;
    this.control = options.control;
    this.signingKey = options.signingKey;
    this.log = options.logger ?? { info: () => undefined, warn: () => undefined };
  }

  async publishManifest(input: { version: string; releaseNotes?: string; artifactUrl: string; checksum: string }): Promise<UpdateManifest> {
    const manifest: UpdateManifest = {
      ...input,
      signature: this.signingKey ? signManifest(input, this.signingKey) : undefined,
      createdAt: now(),
    };
    return this.store.saveManifest(manifest);
  }

  listManifests(): UpdateManifest[] {
    return this.store.listManifests();
  }

  verifyManifest(manifest: UpdateManifest): boolean {
    if (!this.signingKey) return true; // signing not configured — nothing to verify against
    return verifyManifestSignature(manifest, this.signingKey);
  }

  async startRollout(input: { version: string; targetNodeIds?: string[]; targetGroup?: string; strategy: Rollout["strategy"]; stagePct?: number }): Promise<Rollout> {
    const manifest = this.store.getManifest(input.version);
    if (!manifest) throw new Error(`no published manifest for version "${input.version}"`);
    if (!this.verifyManifest(manifest)) throw new Error(`manifest for version "${input.version}" failed signature verification`);

    const allNodes = await this.control.listNodes();
    let targets = allNodes;
    if (input.targetNodeIds?.length) targets = allNodes.filter((n) => input.targetNodeIds!.includes(n.id));
    else if (input.targetGroup) targets = allNodes.filter((n) => n.group === input.targetGroup);

    const rollout = await this.store.createRollout({
      manifest,
      targetNodeIds: targets.map((n) => n.id),
      strategy: input.strategy,
      stagePct: input.stagePct ?? 100,
    });

    await this.dispatchBatch(rollout.id, this.nextBatch(rollout));
    return (await this.store.getRollout(rollout.id)) ?? rollout;
  }

  private nextBatch(rollout: Rollout): string[] {
    const pending = rollout.targetNodeIds.filter((id) => !rollout.perNodeStatus[id]);
    if (rollout.strategy === "all-at-once") return pending;
    const batchSize = Math.max(1, Math.ceil((rollout.targetNodeIds.length * rollout.stagePct) / 100));
    return pending.slice(0, batchSize);
  }

  private async dispatchBatch(rolloutId: string, nodeIds: string[]): Promise<void> {
    if (nodeIds.length === 0) return;
    const rollout = this.store.getRollout(rolloutId);
    if (!rollout) return;
    await this.store.updateRollout(rolloutId, { state: "in-progress" });
    for (const nodeId of nodeIds) {
      const command = await this.control.createCommand(nodeId, "apply_update", {
        version: rollout.manifest.version,
        artifactUrl: rollout.manifest.artifactUrl,
        checksum: rollout.manifest.checksum,
      });
      await this.store.setCommand(rolloutId, nodeId, command.id);
      await this.store.setNodeStatus(rolloutId, nodeId, { state: "applying", updatedAt: now() });
    }
    this.log.info({ rolloutId, nodeIds }, "update batch dispatched");
  }

  /** Continues a staged rollout to the next batch once the current one has settled. */
  async continueRollout(rolloutId: string): Promise<Rollout | undefined> {
    const rollout = this.store.getRollout(rolloutId);
    if (!rollout) return undefined;
    const stillApplying = Object.values(rollout.perNodeStatus).some((s) => s.state === "applying");
    if (stillApplying) throw new Error("current batch is still in progress");
    await this.dispatchBatch(rolloutId, this.nextBatch(rollout));
    return this.store.getRollout(rolloutId);
  }

  /** Call periodically; advances any in-progress rollout's dispatched commands. */
  async pollOnce(): Promise<void> {
    for (const rollout of this.store.listRollouts().filter((r) => r.state === "in-progress")) {
      for (const [nodeId, status] of Object.entries(rollout.perNodeStatus)) {
        if (status.state !== "applying") continue;
        const commandId = this.store.getCommandId(rollout.id, nodeId);
        if (!commandId) continue;
        let command;
        try {
          command = await this.control.getCommand(commandId);
        } catch (err) {
          this.log.warn({ rolloutId: rollout.id, nodeId, err }, "failed to poll update command status");
          continue;
        }
        if (command.status === "succeeded") {
          await this.store.setNodeStatus(rollout.id, nodeId, { state: "succeeded", updatedAt: now() });
          await this.store.clearCommand(rollout.id, nodeId);
        } else if (command.status === "failed" || command.status === "timeout") {
          await this.store.setNodeStatus(rollout.id, nodeId, { state: "failed", error: command.error, updatedAt: now() });
          await this.store.clearCommand(rollout.id, nodeId);
        }
      }
      await this.recomputeRolloutState(rollout.id);
    }
  }

  private async recomputeRolloutState(rolloutId: string): Promise<void> {
    const rollout = this.store.getRollout(rolloutId);
    if (!rollout) return;
    const statuses = Object.values(rollout.perNodeStatus);
    const anyApplying = statuses.some((s) => s.state === "applying");
    const anyFailed = statuses.some((s) => s.state === "failed");
    const allDispatchedSettled = rollout.targetNodeIds.every((id) => rollout.perNodeStatus[id] && rollout.perNodeStatus[id].state !== "applying");
    const allNodesDone = statuses.length === rollout.targetNodeIds.length && allDispatchedSettled;

    if (anyApplying) return;
    if (anyFailed) {
      await this.store.updateRollout(rolloutId, { state: "failed" });
      return;
    }
    if (allNodesDone) {
      await this.store.updateRollout(rolloutId, { state: "completed" });
    }
  }

  async rollback(rolloutId: string): Promise<Rollout | undefined> {
    const rollout = this.store.getRollout(rolloutId);
    if (!rollout) return undefined;
    const succeededNodes = Object.entries(rollout.perNodeStatus)
      .filter(([, status]) => status.state === "succeeded")
      .map(([nodeId]) => nodeId);
    for (const nodeId of succeededNodes) {
      await this.control.createCommand(nodeId, "rollback_update", { version: rollout.manifest.version });
      await this.store.setNodeStatus(rolloutId, nodeId, { state: "rolled-back", updatedAt: now() });
    }
    return this.store.updateRollout(rolloutId, { state: "rolled-back" });
  }

  listRollouts(): Rollout[] {
    return this.store.listRollouts();
  }

  getRollout(id: string): Rollout | undefined {
    return this.store.getRollout(id);
  }
}
