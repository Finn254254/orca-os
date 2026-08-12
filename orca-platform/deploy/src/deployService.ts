import { now, type AppDeployment, type AppManifest } from "@orca/shared";
import { selectNode } from "@orca/scheduler";
import type { ControlPort } from "./controlPort.js";
import type { AppStore } from "./store.js";

export interface DeployServiceOptions {
  store: AppStore;
  control: ControlPort;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

/**
 * Orchestrates the application deployment lifecycle: submit -> schedule
 * (via @orca/scheduler, same engine Compute uses) -> dispatch a
 * `deploy_app` command to the chosen node -> poll for completion -> record
 * the resulting container id. `orca remove` dispatches `remove_app` and
 * marks the deployment stopped.
 */
export class DeployService {
  private readonly store: AppStore;
  private readonly control: ControlPort;
  private readonly log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

  constructor(options: DeployServiceOptions) {
    this.store = options.store;
    this.control = options.control;
    this.log = options.logger ?? { info: () => undefined, warn: () => undefined };
  }

  async deployApp(manifest: AppManifest): Promise<AppDeployment> {
    const deployment = await this.store.createDeployment(manifest);
    await this.scheduleAndDispatch(deployment.id);
    return (await this.store.getDeployment(deployment.id)) ?? deployment;
  }

  private async scheduleAndDispatch(deploymentId: string): Promise<void> {
    const deployment = this.store.getDeployment(deploymentId);
    if (!deployment) return;

    const nodes = await this.control.listNodes();
    const result = selectNode(nodes, {
      targetNodeId: deployment.manifest.targetNodeId,
      targetGroup: deployment.manifest.targetGroup,
      requiredCapabilities: deployment.manifest.targetCapabilities,
      resources: deployment.manifest.resources,
    });

    if (!result.ok) {
      await this.store.updateDeployment(deploymentId, { state: "failed", error: result.failure.reason });
      return;
    }

    await this.store.updateDeployment(deploymentId, {
      state: "scheduled",
      assignedNodeId: result.decision.nodeId,
      schedulingReason: result.decision.reason,
    });

    const command = await this.control.createCommand(result.decision.nodeId, "deploy_app", { manifest: deployment.manifest });
    await this.store.setCommand(deploymentId, command.id);
    await this.store.updateDeployment(deploymentId, { state: "deploying" });
    this.log.info({ deploymentId, nodeId: result.decision.nodeId, commandId: command.id }, "app deployment dispatched");
  }

  /** Call periodically; advances any deployment whose dispatched command has completed. */
  async pollOnce(): Promise<void> {
    for (const deployment of this.store.listInState("deploying")) {
      const commandId = this.store.getCommandId(deployment.id);
      if (!commandId) continue;
      let command;
      try {
        command = await this.control.getCommand(commandId);
      } catch (err) {
        this.log.warn({ deploymentId: deployment.id, commandId, err }, "failed to poll deployment command status");
        continue;
      }
      if (command.status === "succeeded") {
        await this.store.updateDeployment(deployment.id, {
          state: "running",
          containerId: typeof command.result?.containerId === "string" ? command.result.containerId : undefined,
        });
        await this.store.clearCommand(deployment.id);
      } else if (command.status === "failed" || command.status === "timeout") {
        await this.store.updateDeployment(deployment.id, { state: "failed", error: command.error ?? `command ${command.status}` });
        await this.store.clearCommand(deployment.id);
      }
    }
  }

  async removeApp(deploymentId: string): Promise<AppDeployment | undefined> {
    const deployment = this.store.getDeployment(deploymentId);
    if (!deployment) return undefined;
    if (deployment.state === "running" && deployment.assignedNodeId) {
      await this.control.createCommand(deployment.assignedNodeId, "remove_app", { name: deployment.manifest.name });
    }
    return this.store.updateDeployment(deploymentId, { state: "stopped" });
  }

  listDeployments(): AppDeployment[] {
    return this.store.listDeployments();
  }

  getDeployment(id: string): AppDeployment | undefined {
    return this.store.getDeployment(id);
  }
}
