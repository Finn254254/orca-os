import { z } from "zod";

export const StoragePoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  nodeIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});
export type StoragePool = z.infer<typeof StoragePoolSchema>;

export const CreatePoolRequestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  nodeIds: z.array(z.string()).default([]),
});

export const StorageLocationKindSchema = z.enum(["model", "dataset", "app-data", "backup"]);
export type StorageLocationKind = z.infer<typeof StorageLocationKindSchema>;

export const StorageLocationSchema = z.object({
  id: z.string(),
  kind: StorageLocationKindSchema,
  nodeId: z.string(),
  path: z.string(),
  label: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type StorageLocation = z.infer<typeof StorageLocationSchema>;

export const CreateLocationRequestSchema = z.object({
  kind: StorageLocationKindSchema,
  nodeId: z.string(),
  path: z.string(),
  label: z.string().optional(),
});

export interface StorageDeviceView {
  nodeId: string;
  nodeName: string;
  mount: string;
  device?: string;
  filesystem?: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPct: number;
  health: "healthy" | "warning" | "critical";
}

export interface ClusterCapacity {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPct: number;
  deviceCount: number;
  nodeCount: number;
}
