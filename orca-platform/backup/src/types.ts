import { z } from "zod";

export const BackupKindSchema = z.enum(["cluster-config", "app-config", "app-data"]);
export type BackupKind = z.infer<typeof BackupKindSchema>;

export const BackupJobStateSchema = z.enum(["pending", "running", "succeeded", "failed"]);
export type BackupJobState = z.infer<typeof BackupJobStateSchema>;

export interface BackupJob {
  id: string;
  kind: BackupKind;
  targetId?: string; // e.g. an app deployment id, for app-config/app-data
  state: BackupJobState;
  location?: string; // where the backup artifact was written
  sizeBytes?: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RestoreRecord {
  id: string;
  backupJobId: string;
  restoredAt: string;
  restoredBy: string;
  notes?: string;
}

export interface BackupSchedule {
  id: string;
  kind: BackupKind;
  targetId?: string;
  intervalMs: number;
  enabled: boolean;
  lastRunAt?: string;
  createdAt: string;
}

export const CreateBackupRequestSchema = z.object({
  kind: BackupKindSchema,
  targetId: z.string().optional(),
});

export const CreateScheduleRequestSchema = z.object({
  kind: BackupKindSchema,
  targetId: z.string().optional(),
  intervalMs: z.number().int().positive(),
  enabled: z.boolean().default(true),
});

export const CreateRestoreRequestSchema = z.object({
  backupJobId: z.string(),
  restoredBy: z.string(),
  notes: z.string().optional(),
});
