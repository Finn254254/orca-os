import type { CommandRecord, CommandType, NodeRecord } from "@orca/shared";

/** Same shape as @orca/compute's ControlPort — kept as its own local type so Deploy doesn't depend on Compute. */
export interface ControlPort {
  listNodes(): Promise<NodeRecord[]>;
  createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>): Promise<CommandRecord>;
  getCommand(id: string): Promise<CommandRecord>;
}
