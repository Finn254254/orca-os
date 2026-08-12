import type { ChatMessage, Conversation } from "@orca/shared";
import { parseSseChunk } from "./sseParser.js";

const TOKEN_KEY = "orca-ai.token";
const USER_KEY = "orca-ai.user";

export interface SessionUser {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
}

// In dev, Vite proxies /api to Orca API (see vite.config.ts). In a
// production build, set VITE_ORCA_API_URL to point at the API's origin.
const BASE_URL = import.meta.env.VITE_ORCA_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function storeSession(token: string, user: SessionUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearSession();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message: string | undefined;
    try {
      message = JSON.parse(text).error;
    } catch {
      // not JSON — fall through to statusText
    }
    throw new ApiError(message || res.statusText || `HTTP ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export async function login(username: string, password: string): Promise<SessionUser> {
  const res = await api.post<{ token: string; user: SessionUser }>("/api/v1/auth/login", { username, password });
  storeSession(res.token, res.user);
  return res.user;
}

export interface ModelOption {
  id: string;
  owned_by: string;
}

export function listAvailableModels(): Promise<ModelOption[]> {
  return api.get<{ object: string; data: ModelOption[] }>("/api/v1/ai/models").then((r) => r.data);
}

export function listConversations(): Promise<Conversation[]> {
  return api.get<Conversation[]>("/api/v1/ai/conversations");
}

export function getConversation(id: string): Promise<Conversation> {
  return api.get<Conversation>(`/api/v1/ai/conversations/${id}`);
}

export function createConversation(model: string, title?: string): Promise<Conversation> {
  return api.post<Conversation>("/api/v1/ai/conversations", { model, title });
}

export function renameConversation(id: string, title: string): Promise<Conversation> {
  return api.put<Conversation>(`/api/v1/ai/conversations/${id}`, { title });
}

export function deleteConversation(id: string): Promise<void> {
  return api.delete<void>(`/api/v1/ai/conversations/${id}`);
}

/**
 * Sends a message and streams the assistant's reply. `onDelta` is called
 * with each incremental text chunk as it arrives; the returned promise
 * resolves with the full accumulated reply once the stream ends.
 */
export async function sendMessage(
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
): Promise<string> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}/api/v1/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message: string | undefined;
    try {
      message = JSON.parse(text).error;
    } catch {
      // not JSON
    }
    throw new ApiError(message || res.statusText || `HTTP ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const result = parseSseChunk(buffer, chunk);
    buffer = result.remainder;
    for (const text of result.texts) {
      accumulated += text;
      onDelta(text);
    }
  }
  return accumulated;
}

export type { ChatMessage, Conversation };
