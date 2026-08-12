import { join } from "node:path";
import { JsonStore, generateId, now, type AppDeployment, type AppDeploymentState, type AppManifest } from "@orca/shared";

interface DeployState {
  deployments: Record<string, AppDeployment>;
  commandIdByDeployment: Record<string, string>;
}

export class AppStore {
  private readonly store: JsonStore<DeployState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "deployments.json"), { deployments: {}, commandIdByDeployment: {} });
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  async createDeployment(manifest: AppManifest): Promise<AppDeployment> {
    const deployment: AppDeployment = {
      id: generateId("app"),
      manifest,
      state: "pending",
      createdAt: now(),
      updatedAt: now(),
    };
    await this.store.mutate((s) => ({ ...s, deployments: { ...s.deployments, [deployment.id]: deployment } }));
    return deployment;
  }

  listDeployments(): AppDeployment[] {
    return Object.values(this.store.get().deployments).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getDeployment(id: string): AppDeployment | undefined {
    return this.store.get().deployments[id];
  }

  async updateDeployment(id: string, patch: Partial<AppDeployment>): Promise<AppDeployment | undefined> {
    const state = await this.store.mutate((s) => {
      const deployment = s.deployments[id];
      if (!deployment) return s;
      return { ...s, deployments: { ...s.deployments, [id]: { ...deployment, ...patch, updatedAt: now() } } };
    });
    return state.deployments[id];
  }

  async setCommand(deploymentId: string, commandId: string): Promise<void> {
    await this.store.mutate((s) => ({ ...s, commandIdByDeployment: { ...s.commandIdByDeployment, [deploymentId]: commandId } }));
  }

  getCommandId(deploymentId: string): string | undefined {
    return this.store.get().commandIdByDeployment[deploymentId];
  }

  async clearCommand(deploymentId: string): Promise<void> {
    await this.store.mutate((s) => {
      const { [deploymentId]: _removed, ...rest } = s.commandIdByDeployment;
      return { ...s, commandIdByDeployment: rest };
    });
  }

  listInState(...states: AppDeploymentState[]): AppDeployment[] {
    return this.listDeployments().filter((d) => states.includes(d.state));
  }
}
