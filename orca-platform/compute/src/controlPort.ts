import type { CommandRecord, CommandType, NodeRecord } from "@orca/shared";

/**
 * The subset of Orca Control's client Orca Compute needs. Defined here
 * (rather than importing Orca API's concrete ControlClient) so Compute
 * doesn't depend on API's implementation — any object with this shape
 * (e.g. api/src/controlClient.ts's ControlClient) can be passed in.
 */
export interface ControlPort {
  listNodes(): Promise<NodeRecord[]>;
  createCommand(nodeId: string, type: CommandType, payload: Record<string, unknown>): Promise<CommandRecord>;
  getCommand(id: string): Promise<CommandRecord>;
}
