import { MeshMessageSchema, type MeshMessage } from "@orca/shared";
import type { WebSocket } from "ws";

export function encodeMessage(message: MeshMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(raw: string | Buffer): MeshMessage | null {
  try {
    const parsed = JSON.parse(raw.toString());
    const result = MeshMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function send(socket: WebSocket, message: MeshMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(encodeMessage(message));
  }
}
