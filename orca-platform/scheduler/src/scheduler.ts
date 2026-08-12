import type { JobSpec, NodeRecord } from "@orca/shared";

export interface SchedulingDecision {
  nodeId: string;
  score: number;
  reason: string;
}

export interface SchedulingFailure {
  reason: string;
  rejected: { nodeId: string; reason: string }[];
}

export type SchedulingResult = { ok: true; decision: SchedulingDecision } | { ok: false; failure: SchedulingFailure };

/**
 * Orca-specific scheduler: filters nodes by hard requirements (health,
 * group/target pin, required capability tags, CPU/RAM/GPU/VRAM), then
 * scores survivors by available headroom (free CPU%, free RAM%, a
 * temperature penalty) and picks the best. Deliberately not a
 * Kubernetes-style scheduler — a small, explainable scoring function that's
 * easy to extend as real workload needs emerge.
 */
export function selectNode(nodes: NodeRecord[], spec: JobSpec): SchedulingResult {
  const rejected: { nodeId: string; reason: string }[] = [];
  const candidates: { node: NodeRecord; score: number; reasons: string[] }[] = [];

  for (const node of nodes) {
    const reasonForRejection = whyIneligible(node, spec);
    if (reasonForRejection) {
      rejected.push({ nodeId: node.id, reason: reasonForRejection });
      continue;
    }
    const { score, reasons } = scoreNode(node);
    candidates.push({ node, score, reasons });
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      failure: {
        reason: nodes.length === 0 ? "no nodes registered" : "no eligible node met the job's requirements",
        rejected,
      },
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    ok: true,
    decision: {
      nodeId: best.node.id,
      score: best.score,
      reason: `selected ${best.node.name}: ${best.reasons.join(", ")}`,
    },
  };
}

function whyIneligible(node: NodeRecord, spec: JobSpec): string | undefined {
  if (spec.targetNodeId && node.id !== spec.targetNodeId) return "not the pinned target node";
  if (spec.targetGroup && node.group !== spec.targetGroup) return `not in target group "${spec.targetGroup}"`;
  if (node.status !== "online") return `status is "${node.status}", not online`;

  const caps = node.capabilities;
  for (const tag of spec.requiredCapabilities) {
    if (!caps?.tags?.includes(tag)) return `missing required capability tag "${tag}"`;
  }

  const { cpuCores, ramBytes, gpu, vramBytes } = spec.resources;
  if (cpuCores !== undefined && (caps?.cpuCores ?? 0) < cpuCores) {
    return `has ${caps?.cpuCores ?? 0} CPU cores, needs ${cpuCores}`;
  }
  if (ramBytes !== undefined) {
    const available = availableRamBytes(node);
    if (available < ramBytes) return `has ~${formatBytes(available)} free RAM, needs ${formatBytes(ramBytes)}`;
  }
  if (gpu && (caps?.gpus?.length ?? 0) === 0) return "no GPU present";
  if (vramBytes !== undefined) {
    const bestGpuVram = Math.max(0, ...(caps?.gpus ?? []).map((g) => (g.vramTotalBytes ?? 0) - (g.vramUsedBytes ?? 0)));
    if (bestGpuVram < vramBytes) return `no GPU with ~${formatBytes(vramBytes)} free VRAM`;
  }
  return undefined;
}

function availableRamBytes(node: NodeRecord): number {
  const total = node.lastMetrics?.ramTotalBytes ?? node.capabilities?.ramTotalBytes ?? 0;
  const used = node.lastMetrics?.ramUsedBytes ?? 0;
  return Math.max(0, total - used);
}

function scoreNode(node: NodeRecord): { score: number; reasons: string[] } {
  const cpuUtil = node.lastMetrics?.cpuUtilizationPct;
  const freeCpuPct = cpuUtil === undefined ? 50 : 100 - cpuUtil;

  const ramTotal = node.lastMetrics?.ramTotalBytes ?? node.capabilities?.ramTotalBytes;
  const ramUsed = node.lastMetrics?.ramUsedBytes;
  const freeRamPct = ramTotal && ramUsed !== undefined ? ((ramTotal - ramUsed) / ramTotal) * 100 : 50;

  const cpuTemp = node.lastMetrics?.temperatures?.cpu;
  const tempPenalty = cpuTemp !== undefined && cpuTemp > 80 ? (cpuTemp - 80) * 2 : 0;

  const score = freeCpuPct * 0.5 + freeRamPct * 0.5 - tempPenalty;
  const reasons = [
    cpuUtil !== undefined ? `${freeCpuPct.toFixed(0)}% free CPU` : "no CPU metrics yet",
    ramTotal && ramUsed !== undefined ? `${freeRamPct.toFixed(0)}% free RAM` : "no RAM metrics yet",
  ];
  if (tempPenalty > 0) reasons.push(`hot CPU (${cpuTemp}°C) penalized`);
  return { score, reasons };
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)}${units[unit]}`;
}
