import cors from "cors";
import express from "express";
import { createServer, type Server } from "node:http";
import { MeshServer } from "@orca/mesh";
import { createLogger, type Logger } from "@orca/shared";
import type { ControlConfig } from "./config.js";
import { createControlRouter } from "./http.js";
import { startHealthSweeper } from "./health.js";
import { requireServiceToken } from "./serviceAuth.js";
import { ClusterStore } from "./store.js";

export interface ControlServerHandle {
  httpServer: Server;
  store: ClusterStore;
  mesh: MeshServer;
  logger: Logger;
  close: () => Promise<void>;
}

export async function createControlServer(config: ControlConfig): Promise<ControlServerHandle> {
  const logger = createLogger("orca-control");
  const store = new ClusterStore(config.dataDir, config.clusterName);
  await store.init();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const httpServer = createServer(app);

  const mesh = new MeshServer({
    httpServer,
    token: config.clusterToken,
    getClusterConfig: () => store.getClusterConfig(),
    logger,
  });

  mesh.on("hello", async ({ nodeId, name, group, capabilities }) => {
    await store.registerNode({ nodeId, name, group, capabilities });
    logger.info({ nodeId, name, group }, "node registered");
  });

  mesh.on("heartbeat", async ({ nodeId, metrics, services }) => {
    const updated = await store.recordHeartbeat(nodeId, metrics, services);
    if (!updated) logger.warn({ nodeId }, "heartbeat from unknown node");
  });

  mesh.on("commandResult", async ({ nodeId, commandId, status, result, error }) => {
    await store.completeCommand(commandId, status, result, error);
    logger.info({ nodeId, commandId, status }, "command result");
  });

  mesh.on("disconnect", async ({ nodeId }) => {
    await store.setNodeStatus(nodeId, "offline");
    logger.info({ nodeId }, "node disconnected");
  });

  app.use("/api/v1", requireServiceToken(config.serviceToken), createControlRouter(store, mesh));

  const stopSweeper = startHealthSweeper(store, {
    onOffline: (nodeId) => logger.warn({ nodeId }, "node heartbeat timed out, marked offline"),
  });

  await new Promise<void>((resolve) => httpServer.listen(config.port, resolve));
  logger.info({ port: config.port }, "orca-control listening");

  return {
    httpServer,
    store,
    mesh,
    logger,
    close: async () => {
      stopSweeper();
      await mesh.close();
      await store.flush();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
