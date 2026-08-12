import { useState } from "react";
import type { Conversation } from "@orca/shared";
import type { SessionUser } from "../api.js";

interface SidebarProps {
  conversations: Conversation[];
  selectedId: string | undefined;
  user: SessionUser | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
}

export function Sidebar({ conversations, selectedId, user, onSelect, onNew, onRename, onDelete, onSignOut }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editValue, setEditValue] = useState("");

  function startRename(c: Conversation) {
    setEditingId(c.id);
    setEditValue(c.title);
  }

  function commitRename(id: string) {
    const title = editValue.trim();
    if (title) onRename(id, title);
    setEditingId(undefined);
  }

  return (
    <div className="ai-sidebar">
      <div className="ai-sidebar-header">
        <span className="ai-brand">Orca AI</span>
        <button className="secondary" onClick={onNew}>
          + New chat
        </button>
      </div>
      <div className="ai-conversation-list">
        {conversations.length === 0 && <div className="muted ai-empty-list">No conversations yet</div>}
        {conversations.map((c) => (
          <div key={c.id} className={`ai-conversation-item${c.id === selectedId ? " active" : ""}`} onClick={() => onSelect(c.id)}>
            {editingId === c.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(c.id);
                  if (e.key === "Escape") setEditingId(undefined);
                }}
              />
            ) : (
              <span className="ai-conversation-title" onDoubleClick={() => startRename(c)} title="Double-click to rename">
                {c.title}
              </span>
            )}
            <button
              className="ai-delete-btn"
              aria-label={`Delete ${c.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="ai-sidebar-footer">
        <span className="muted">{user?.username}</span>
        <button className="secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
