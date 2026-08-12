import type { ChatMessage } from "@orca/shared";
import { Markdown } from "./Markdown.js";

export function MessageBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  return (
    <div className={`ai-message ai-message-${message.role}`}>
      <div className="ai-message-role">{message.role === "user" ? "You" : "Assistant"}</div>
      <div className="ai-message-content">
        <Markdown text={message.content} />
        {streaming && <span className="ai-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}
