import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage } from "@orca/shared";
import {
  clearSession,
  createConversation,
  deleteConversation,
  getConversation,
  getStoredUser,
  listAvailableModels,
  renameConversation,
  sendMessage,
  type ModelOption,
} from "../api.js";
import { MessageBubble } from "../components/MessageBubble.js";
import { ModelPicker } from "../components/ModelPicker.js";
import { Sidebar } from "../components/Sidebar.js";
import { useConversations } from "../hooks/useConversations.js";

export function Chat() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const { conversations, setConversations, refresh } = useConversations();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingText, setStreamingText] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAvailableModels()
      .then((list) => {
        setModels(list);
        setSelectedModel((current) => current || list[0]?.id || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    setStreamingText(undefined);
    setError(undefined);
    try {
      const conversation = await getConversation(id);
      setMessages(conversation.messages);
      setSelectedModel(conversation.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function startNewChat() {
    setSelectedId(undefined);
    setMessages([]);
    setStreamingText(undefined);
    setError(undefined);
  }

  async function handleRename(id: string, title: string) {
    try {
      const updated = await renameConversation(id, title);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) startNewChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function signOut() {
    clearSession();
    navigate("/login");
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    if (!selectedModel) {
      setError("No model selected");
      return;
    }

    setSending(true);
    setError(undefined);
    setDraft("");

    try {
      let conversationId = selectedId;
      if (!conversationId) {
        const title = content.length > 48 ? `${content.slice(0, 48)}…` : content;
        const conversation = await createConversation(selectedModel, title);
        conversationId = conversation.id;
        setSelectedId(conversationId);
        setConversations((prev) => [conversation, ...prev]);
      }

      setMessages((prev) => [...prev, { role: "user", content }]);
      setStreamingText("");

      const reply = await sendMessage(conversationId, content, (delta) => {
        setStreamingText((prev) => (prev ?? "") + delta);
      });

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      setStreamingText(undefined);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStreamingText(undefined);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as FormEvent);
    }
  }

  return (
    <div className="ai-shell">
      <Sidebar
        conversations={conversations}
        selectedId={selectedId}
        user={user}
        onSelect={selectConversation}
        onNew={startNewChat}
        onRename={handleRename}
        onDelete={handleDelete}
        onSignOut={signOut}
      />
      <div className="ai-main">
        <div className="ai-topbar">
          <ModelPicker models={models} value={selectedModel} onChange={setSelectedModel} disabled={Boolean(selectedId)} />
        </div>
        <div className="ai-messages" ref={scrollRef}>
          {messages.length === 0 && !streamingText && <div className="muted ai-empty-chat">Start a conversation below.</div>}
          {messages.map((m, idx) => (
            <MessageBubble key={idx} message={m} />
          ))}
          {streamingText !== undefined && <MessageBubble message={{ role: "assistant", content: streamingText }} streaming />}
        </div>
        {error && <div className="error-text ai-error">{error}</div>}
        <form className="ai-composer" onSubmit={handleSend}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Orca AI…"
            rows={2}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
