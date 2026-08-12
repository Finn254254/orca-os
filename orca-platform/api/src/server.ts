import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { AiGatewayService, createAiGatewayRouter } from "@orca/ai-gateway";
import { AppBackendService, DeviceStore, NotificationStore, createAppBackendRouter } from "@orca/app-backend";
import { JobService, JobStore, createJobsRouter, startJobPoller } from "@orca/compute";
import { AppStore, DeployService, createAppsRouter, startDeployPoller } from "@orca/deploy";
import { BackupService, BackupStore, createBackupRouter, startBackupScheduler } from "@orca/backup";
import { LlamaCppAdapter, ModelService, ModelStore, OllamaAdapter, createModelsRouter } from "@orca/models";
import { AuditLog, UserStore } from "@orca/security";
import { StorageService, StorageStore, createStorageRouter } from "@orca/storage";
import { UpdateService, UpdateStore, createUpdateRouter, startUpdatePoller } from "@orca/update";
import { createLogger, type Logger } from "@orca/shared";
import type { ApiConfig } from "./config.js";
import { ControlClient, ControlClientError } from "./controlClient.js";
import { ConversationStore } from "./conversationStore.js";
import { auditMiddleware } from "./middleware/audit.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { buildOpenApiSpec } from "./openapi.js";
import { createRealtimeHub, type RealtimeHub } from "./realtime.js";
import { createAuthRouter } from "./routes/auth.js";
import { createClusterRouter } from "./routes/cluster.js";
import { createCommandsRouter } from "./routes/commands.js";
import { createNodesRouter } from "./routes/nodes.js";
import { createStudioRouter } from "./routes/studio.js";
import { createUsersRouter } from "./routes/users.js";
import { AgentConfigStore } from "./studioAgentConfigStore.js";
import { RunStore as StudioRunStore } from "./studioRunStore.js";
import { StudioService } from "./studioService.js";
import { WorkflowStore } from "./studioWorkflowStore.js";

export interface ApiServerHandle {
  httpServer: Server;
  users: UserStore;
  audit: AuditLog;
  control: ControlClient;
  jobs: JobService;
  models: ModelService;
  deploy: DeployService;
  backup: BackupService;
  storage: StorageService;
  update: UpdateService;
  aiGateway: AiGatewayService;
  conversations: ConversationStore;
  studio: StudioService;
  appBackend: AppBackendService;
  realtime: RealtimeHub;
  logger: Logger;
  close: () => Promise<void>;
}

export async function createApiServer(config: ApiConfig): Promise<ApiServerHandle> {
  const logger = createLogger("orca-api");
  const users = new UserStore(config.dataDir);
  await users.init();
  const audit = new AuditLog(config.dataDir);
  await audit.init();

  if (config.bootstrapAdminUsername && config.bootstrapAdminPassword) {
    const created = await users.bootstrapAdmin(config.bootstrapAdminUsername, config.bootstrapAdminPassword);
    if (created) logger.info({ username: created.username }, "bootstrapped initial admin user");
  } else if (!users.hasAnyUser()) {
    logger.warn(
      "no users exist and ORCA_ADMIN_USERNAME/ORCA_ADMIN_PASSWORD are not set — no one will be able to log in until a user is created",
    );
  }

  const control = new ControlClient(config.controlUrl, process.env.ORCA_CONTROL_SERVICE_TOKEN);

  const jobStore = new JobStore(join(config.dataDir, "compute"));
  await jobStore.init();
  const jobs = new JobService({ store: jobStore, control, logger });
  const stopJobPoller = startJobPoller(jobs);

  const modelStore = new ModelStore(join(config.dataDir, "models"));
  await modelStore.init();
  const models = new ModelService({
    store: modelStore,
    adapters: { ollama: new OllamaAdapter(), llamacpp: new LlamaCppAdapter() },
    logger,
  });

  const appStore = new AppStore(join(config.dataDir, "deploy"));
  await appStore.init();
  const deploy = new DeployService({ store: appStore, control, logger });
  const stopDeployPoller = startDeployPoller(deploy);

  const backupStore = new BackupStore(join(config.dataDir, "backup"));
  await backupStore.init();
  const backup = new BackupService({
    store: backupStore,
    backupDir: join(config.dataDir, "backup", "artifacts"),
    getClusterConfig: () => control.getClusterConfig(),
    getAppManifest: async (id) => deploy.getDeployment(id)?.manifest,
    logger,
  });
  const stopBackupScheduler = startBackupScheduler(backup);

  const storageStore = new StorageStore(join(config.dataDir, "storage"));
  await storageStore.init();
  const storage = new StorageService(control, storageStore);

  const updateStore = new UpdateStore(join(config.dataDir, "update"));
  await updateStore.init();
  const update = new UpdateService({ store: updateStore, control, signingKey: process.env.ORCA_UPDATE_SIGNING_KEY, logger });
  const stopUpdatePoller = startUpdatePoller(update);

  const conversations = new ConversationStore(join(config.dataDir, "ai"));
  await conversations.init();

  const aiGateway = new AiGatewayService({
    models: modelStore,
    runtimeUrls: {
      ollama: process.env.ORCA_OLLAMA_URL ?? "http://localhost:11434",
      llamacpp: process.env.ORCA_LLAMACPP_SERVER_URL,
    },
  });

  const studioAgentConfigs = new AgentConfigStore(join(config.dataDir, "studio"));
  await studioAgentConfigs.init();
  const studioWorkflows = new WorkflowStore(join(config.dataDir, "studio"));
  await studioWorkflows.init();
  const studioRuns = new StudioRunStore(join(config.dataDir, "studio"));
  await studioRuns.init();
  const studio = new StudioService({
    agentConfigs: studioAgentConfigs,
    workflows: studioWorkflows,
    runs: studioRuns,
    runtime: {
      complete: async (model, messages) => {
        const response = await aiGateway.chatCompletion({ model, messages });
        return response.choices[0]?.message.content ?? "";
      },
    },
    logger,
  });

  const appNotifications = new NotificationStore(join(config.dataDir, "app"));
  await appNotifications.init();
  const appDevices = new DeviceStore(join(config.dataDir, "app"));
  await appDevices.init();
  const appBackend = new AppBackendService({
    cluster: control,
    users: { listUserIds: () => users.listUsers().map((u) => u.id) },
    notifications: appNotifications,
    devices: appDevices,
  });

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(auditMiddleware(audit));

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", service: "orca-api", time: new Date().toISOString() }));
  app.get("/api/v1/openapi.json", (_req, res) => res.json(buildOpenApiSpec()));
  app.get("/api/v1/audit", requireAuth(config.sessionSecret), requireRole("admin"), (req, res) => {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(audit.list(limit));
  });
  app.use("/api/v1/auth", createAuthRouter(users, config.sessionSecret));
  app.use("/api/v1/users", createUsersRouter(users, config.sessionSecret));
  app.use("/api/v1/nodes", createNodesRouter(control, config.sessionSecret));
  app.use("/api/v1/commands", createCommandsRouter(control, config.sessionSecret));
  app.use("/api/v1/cluster", createClusterRouter(control, config.sessionSecret));
  app.use(
    "/api/v1/jobs",
    requireAuth(config.sessionSecret),
    createJobsRouter(jobs, requireRole("admin", "operator")),
  );
  app.use(
    "/api/v1/models",
    requireAuth(config.sessionSecret),
    createModelsRouter(models, requireRole("admin", "operator")),
  );
  app.use("/api/v1/ai", requireAuth(config.sessionSecret), createAiGatewayRouter(aiGateway));
  app.use(
    "/api/v1/ai/conversations",
    requireAuth(config.sessionSecret),
    createConversationsRouter(conversations, aiGateway),
  );
  app.use("/api/v1/studio", requireAuth(config.sessionSecret), createStudioRouter(studio));
  app.use("/api/v1/app", createAppBackendRouter(appBackend, requireAuth(config.sessionSecret), requireRole("admin", "operator")));
  app.use(
    "/api/v1/apps",
    requireAuth(config.sessionSecret),
    createAppsRouter(deploy, requireRole("admin", "operator")),
  );
  app.use(
    "/api/v1/backups",
    requireAuth(config.sessionSecret),
    createBackupRouter(backup, requireRole("admin", "operator")),
  );
  app.use(
    "/api/v1/storage",
    requireAuth(config.sessionSecret),
    createStorageRouter(storage, requireRole("admin", "operator")),
  );
  app.use(
    "/api/v1/updates",
    requireAuth(config.sessionSecret),
    createUpdateRouter(update, requireRole("admin")),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ControlClientError) {
      res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
      return;
    }
    logger.error({ err }, "unhandled API error");
    res.status(500).json({ error: "internal server error" });
  });

  const httpServer = createServer(app);
  const realtime = createRealtimeHub(httpServer, control, config.pollIntervalMs);

  await new Promise<void>((resolve) => httpServer.listen(config.port, resolve));
  logger.info({ port: config.port, controlUrl: config.controlUrl }, "orca-api listening");

  return {
    httpServer,
    users,
    audit,
    control,
    jobs,
    models,
    deploy,
    backup,
    storage,
    update,
    aiGateway,
    conversations,
    studio,
    appBackend,
    realtime,
    logger,
    close: async () => {
      stopJobPoller();
      stopDeployPoller();
      stopBackupScheduler();
      stopUpdatePoller();
      realtime.close();
      // Give any just-fired res.on("finish") audit handlers a tick to enqueue their write before flushing.
      await new Promise((resolve) => setImmediate(resolve));
      await audit.flush();
      await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
