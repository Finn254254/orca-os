import { z } from "zod";

/**
 * Canonical domain schemas shared across every Orca Platform service.
 * These are the source of truth for wire formats between Agent <-> Mesh <-> Control <-> API <-> CLI/Dashboard.
 */

export const NodeStatusSchema = z.enum(["online", "offline", "degraded", "unknown"]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const GpuInfoSchema = z.object({
  index: z.number().int().nonnegative(),
  vendor: z.string(),
  model: z.string(),
  vramTotalBytes: z.number().nonnegative().optional(),
  vramUsedBytes: z.number().nonnegative().optional(),
  utilizationPct: z.number().min(0).max(100).optional(),
  temperatureC: z.number().optional(),
});
export type GpuInfo = z.infer<typeof GpuInfoSchema>;

export const DiskInfoSchema = z.object({
  mount: z.string(),
  device: z.string().optional(),
  totalBytes: z.number().nonnegative(),
  usedBytes: z.number().nonnegative(),
  filesystem: z.string().optional(),
});
export type DiskInfo = z.infer<typeof DiskInfoSchema>;

export const NetworkInterfaceInfoSchema = z.object({
  name: z.string(),
  address: z.string().optional(),
  mac: z.string().optional(),
  rxBytesPerSec: z.number().nonnegative().optional(),
  txBytesPerSec: z.number().nonnegative().optional(),
});
export type NetworkInterfaceInfo = z.infer<typeof NetworkInterfaceInfoSchema>;

export const NodeCapabilitiesSchema = z.object({
  cpuModel: z.string().optional(),
  cpuCores: z.number().int().positive().optional(),
  cpuArch: z.string().optional(),
  ramTotalBytes: z.number().nonnegative().optional(),
  gpus: z.array(GpuInfoSchema).default([]),
  osName: z.string().optional(),
  osVersion: z.string().optional(),
  orcaVersion: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type NodeCapabilities = z.infer<typeof NodeCapabilitiesSchema>;

export const NodeMetricsSchema = z.object({
  timestamp: z.string().datetime(),
  cpuUtilizationPct: z.number().min(0).max(100).optional(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]).optional(),
  ramUsedBytes: z.number().nonnegative().optional(),
  ramTotalBytes: z.number().nonnegative().optional(),
  disks: z.array(DiskInfoSchema).default([]),
  network: z.array(NetworkInterfaceInfoSchema).default([]),
  gpus: z.array(GpuInfoSchema).default([]),
  temperatures: z.record(z.string(), z.number()).default({}),
  uptimeSeconds: z.number().nonnegative().optional(),
});
export type NodeMetrics = z.infer<typeof NodeMetricsSchema>;

export const ServiceStatusSchema = z.object({
  name: z.string(),
  state: z.enum(["running", "stopped", "failed", "unknown"]),
  detail: z.string().optional(),
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const NodeRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string().default("default"),
  address: z.string().optional(),
  status: NodeStatusSchema,
  capabilities: NodeCapabilitiesSchema.optional(),
  lastMetrics: NodeMetricsSchema.optional(),
  services: z.array(ServiceStatusSchema).default([]),
  registeredAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime().optional(),
  labels: z.record(z.string(), z.string()).default({}),
});
export type NodeRecord = z.infer<typeof NodeRecordSchema>;

export const NodeGroupSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});
export type NodeGroup = z.infer<typeof NodeGroupSchema>;

export const ClusterConfigSchema = z.object({
  clusterName: z.string().default("orca-cluster"),
  groups: z.array(NodeGroupSchema).default([{ name: "default" }]),
  heartbeatIntervalMs: z.number().int().positive().default(5000),
  heartbeatTimeoutMs: z.number().int().positive().default(17000),
  settings: z.record(z.string(), z.string()).default({}),
});
export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;

export const CommandTypeSchema = z.enum([
  "ping",
  "restart_service",
  "stop_service",
  "start_service",
  "shell",
  "power",
  "run_job",
  "deploy_app",
  "remove_app",
  "apply_update",
  "rollback_update",
]);
export type CommandType = z.infer<typeof CommandTypeSchema>;

export const CommandStatusSchema = z.enum(["pending", "sent", "running", "succeeded", "failed", "timeout"]);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

export const CommandRecordSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  type: CommandTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  status: CommandStatusSchema,
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type CommandRecord = z.infer<typeof CommandRecordSchema>;

// ---- Mesh protocol envelope (Agent <-> Control) ----

export const MeshHelloSchema = z.object({
  type: z.literal("hello"),
  token: z.string(),
  nodeId: z.string(),
  name: z.string(),
  group: z.string().optional(),
  capabilities: NodeCapabilitiesSchema.optional(),
});

export const MeshHeartbeatSchema = z.object({
  type: z.literal("heartbeat"),
  nodeId: z.string(),
  metrics: NodeMetricsSchema.optional(),
  services: z.array(ServiceStatusSchema).optional(),
});

export const MeshCommandResultSchema = z.object({
  type: z.literal("command_result"),
  nodeId: z.string(),
  commandId: z.string(),
  status: CommandStatusSchema,
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const MeshCommandSchema = z.object({
  type: z.literal("command"),
  command: CommandRecordSchema,
});

export const MeshAckSchema = z.object({
  type: z.literal("ack"),
  nodeId: z.string(),
  clusterConfig: ClusterConfigSchema.optional(),
});

export const MeshErrorSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const MeshMessageSchema = z.discriminatedUnion("type", [
  MeshHelloSchema,
  MeshHeartbeatSchema,
  MeshCommandResultSchema,
  MeshCommandSchema,
  MeshAckSchema,
  MeshErrorSchema,
]);
export type MeshMessage = z.infer<typeof MeshMessageSchema>;
export type MeshHello = z.infer<typeof MeshHelloSchema>;
export type MeshHeartbeat = z.infer<typeof MeshHeartbeatSchema>;
export type MeshCommandResult = z.infer<typeof MeshCommandResultSchema>;
export type MeshCommand = z.infer<typeof MeshCommandSchema>;
export type MeshAck = z.infer<typeof MeshAckSchema>;
export type MeshError = z.infer<typeof MeshErrorSchema>;

// ---- Compute jobs ----

export const JobStateSchema = z.enum([
  "queued",
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobResourceRequestSchema = z.object({
  cpuCores: z.number().positive().optional(),
  ramBytes: z.number().positive().optional(),
  gpu: z.boolean().optional(),
  vramBytes: z.number().positive().optional(),
});
export type JobResourceRequest = z.infer<typeof JobResourceRequestSchema>;

export const JobSpecSchema = z.object({
  type: z.string(),
  command: z.array(z.string()).optional(),
  workload: z.record(z.string(), z.unknown()).default({}),
  resources: JobResourceRequestSchema.default({}),
  requiredCapabilities: z.array(z.string()).default([]),
  targetNodeId: z.string().optional(),
  targetGroup: z.string().optional(),
});
export type JobSpec = z.infer<typeof JobSpecSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  spec: JobSpecSchema,
  state: JobStateSchema,
  assignedNodeId: z.string().optional(),
  schedulingReason: z.string().optional(),
  progressPct: z.number().min(0).max(100).default(0),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  logs: z.array(z.string()).default([]),
  result: z.record(z.string(), z.unknown()).optional(),
  failureReason: z.string().optional(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

// ---- Deploy (application manifests + deployments) ----

export const RestartPolicySchema = z.enum(["always", "on-failure", "never"]);
export type RestartPolicy = z.infer<typeof RestartPolicySchema>;

export const PortMappingSchema = z.object({
  containerPort: z.number().int().positive(),
  hostPort: z.number().int().positive().optional(),
  protocol: z.enum(["tcp", "udp"]).default("tcp"),
});
export type PortMapping = z.infer<typeof PortMappingSchema>;

export const VolumeMountSchema = z.object({
  hostPath: z.string(),
  containerPath: z.string(),
  readOnly: z.boolean().default(false),
});
export type VolumeMount = z.infer<typeof VolumeMountSchema>;

export const AppManifestSchema = z.object({
  name: z.string(),
  version: z.string().default("latest"),
  image: z.string(),
  ports: z.array(PortMappingSchema).default([]),
  volumes: z.array(VolumeMountSchema).default([]),
  env: z.record(z.string(), z.string()).default({}),
  resources: JobResourceRequestSchema.default({}),
  targetCapabilities: z.array(z.string()).default([]),
  targetNodeId: z.string().optional(),
  targetGroup: z.string().optional(),
  restartPolicy: RestartPolicySchema.default("on-failure"),
});
export type AppManifest = z.infer<typeof AppManifestSchema>;

export const AppDeploymentStateSchema = z.enum(["pending", "scheduled", "deploying", "running", "failed", "stopped"]);
export type AppDeploymentState = z.infer<typeof AppDeploymentStateSchema>;

export const AppDeploymentSchema = z.object({
  id: z.string(),
  manifest: AppManifestSchema,
  state: AppDeploymentStateSchema,
  assignedNodeId: z.string().optional(),
  schedulingReason: z.string().optional(),
  containerId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().optional(),
});
export type AppDeployment = z.infer<typeof AppDeploymentSchema>;

// ---- Update (cluster-wide version rollout) ----

export const UpdateManifestSchema = z.object({
  version: z.string(),
  releaseNotes: z.string().optional(),
  artifactUrl: z.string(),
  checksum: z.string(),
  signature: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

export const RolloutStrategySchema = z.enum(["all-at-once", "staged"]);
export type RolloutStrategy = z.infer<typeof RolloutStrategySchema>;

export const RolloutStateSchema = z.enum(["pending", "in-progress", "completed", "failed", "rolled-back"]);
export type RolloutState = z.infer<typeof RolloutStateSchema>;

export const NodeUpdateStatusSchema = z.object({
  state: z.enum(["pending", "applying", "succeeded", "failed", "rolled-back"]),
  error: z.string().optional(),
  updatedAt: z.string().datetime(),
});
export type NodeUpdateStatus = z.infer<typeof NodeUpdateStatusSchema>;

export const RolloutSchema = z.object({
  id: z.string(),
  manifest: UpdateManifestSchema,
  targetNodeIds: z.array(z.string()),
  strategy: RolloutStrategySchema,
  stagePct: z.number().min(1).max(100).default(100),
  state: RolloutStateSchema,
  perNodeStatus: z.record(z.string(), NodeUpdateStatusSchema).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Rollout = z.infer<typeof RolloutSchema>;

// ---- Models ----

export const ModelRuntimeSchema = z.enum(["ollama", "llamacpp", "mock"]);
export type ModelRuntime = z.infer<typeof ModelRuntimeSchema>;

export const ModelStateSchema = z.enum(["not_downloaded", "downloading", "available", "loaded", "error"]);
export type ModelState = z.infer<typeof ModelStateSchema>;

export const ModelRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  runtime: ModelRuntimeSchema,
  format: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  state: ModelStateSchema,
  downloadProgressPct: z.number().min(0).max(100).optional(),
  nodeId: z.string().optional(),
  storagePath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ModelRecord = z.infer<typeof ModelRecordSchema>;

// ---- Security / users ----

export const UserRoleSchema = z.enum(["admin", "operator", "viewer"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserRecordSchema = z.object({
  id: z.string(),
  username: z.string(),
  passwordHash: z.string(),
  role: UserRoleSchema,
  createdAt: z.string().datetime(),
});
export type UserRecord = z.infer<typeof UserRecordSchema>;

export const SessionRecordSchema = z.object({
  token: z.string(),
  userId: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  actor: z.string(),
  action: z.string(),
  target: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ---- Realtime / alerts / logs ----

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertEventSchema = z.object({
  id: z.string(),
  severity: AlertSeveritySchema,
  source: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

export const LogEntrySchema = z.object({
  id: z.string(),
  source: z.string(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  timestamp: z.string().datetime(),
  nodeId: z.string().optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

// ---- Realtime WS event envelope used by Orca API ----

export const RealtimeEventSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("node"), event: z.string(), data: NodeRecordSchema }),
  z.object({ channel: z.literal("metrics"), event: z.string(), data: z.object({ nodeId: z.string(), metrics: NodeMetricsSchema }) }),
  z.object({ channel: z.literal("job"), event: z.string(), data: JobRecordSchema }),
  z.object({ channel: z.literal("log"), event: z.string(), data: LogEntrySchema }),
  z.object({ channel: z.literal("alert"), event: z.string(), data: AlertEventSchema }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
