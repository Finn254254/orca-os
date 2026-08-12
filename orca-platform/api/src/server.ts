import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { AiGatewayService, createAiGatewayRouter } from "@orca/ai-gateway";
import { JobService, JobStore, createJobsRouter, startJobPoller } from "@orca/compute";
import { AppStore, DeployService, createAppsRouter, startDeployPoller } from "@orca/deploy";
import { LlamaCppAdapter, ModelService, ModelStore, OllamaAdapter, createModelsRouter } from "@orca/models";
import { UserStore } from "@orca/security";
import { StorageService, StorageStore, createStorageRouter } from "@orca/storage";
import { createLogger, type Logger } from "@orca/shared";
import type { ApiConfig } from "./config.js";
import { ControlClient, ControlClientError } from "./controlClient.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { buildOpenApiSpec } from "./openapi.js";
import { createRealtimeHub, type RealtimeHub } from "./realtime.js";
import { createAuthRouter } from "./routes/auth.js";
import { createClusterRouter } from "./routes/cluster.js";
import { createCommandsRouter } from "./routes/commands.js";
import { createNodesRouter } from "./routes/nodes.js";
import { createUsersRouter } from "./routes/users.js";

export interface ApiServerHandle {
  httpServer: Server;
  users: UserStore;
  control: ControlClient;
  jobs: JobService;
  models: ModelService;
  deploy: DeployService;
  storage: StorageService;
  aiGateway: AiGatewayService;
  realtime: RealtimeHub;
  logger: Logger;
  close: () => Promise<void>;
}

export async function createApiServer(config: ApiConfig): Promise<ApiServerHandle> {
  const logger = createLogger("orca-api");
  const users = new UserStore(config.dataDir);
  await users.init();

  if (config.bootstrapAdminUsername && config.bootstrapAdminPassword) {
    const created = await users.bootstrapAdmin(config.bootstrapAdminUsername, config.bootstrapAdminPassword);
    if (created) logger.info({ username: created.username }, "bootstrapped initial admin user");
  } else if (!users.hasAnyUser()) {
    logger.warn(
      "no users exist and ORCA_ADMIN_USERNAME/ORCA_ADMIN_PASSWORD are not set — no one will be able to log in until a user is created",
    );
  }

  const control = new ControlClient(config.controlUrl);

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

  const storageStore = new StorageStore(join(config.dataDir, "storage"));
  await storageStore.init();
  const storage = new StorageService(control, storageStore);

  const aiGateway = new AiGatewayService({
    models: modelStore,
    runtimeUrls: {
      ollama: process.env.ORCA_OLLAMA_URL ?? "http://localhost:11434",
      llamacpp: process.env.ORCA_LLAMACPP_SERVER_URL,
    },
  });

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", service: "orca-api", time: new Date().toISOString() }));
  app.get("/api/v1/openapi.json", (_req, res) => res.json(buildOpenApiSpec()));
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
    "/api/v1/apps",
    requireAuth(config.sessionSecret),
    createAppsRouter(deploy, requireRole("admin", "operator")),
  );
  app.use(
    "/api/v1/storage",
    requireAuth(config.sessionSecret),
    createStorageRouter(storage, requireRole("admin", "operator")),
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
    control,
    jobs,
    models,
    deploy,
    storage,
    aiGateway,
    realtime,
    logger,
    close: async () => {
      stopJobPoller();
      stopDeployPoller();
      realtime.close();
      await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
