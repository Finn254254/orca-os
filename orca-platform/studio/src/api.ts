import type { StudioAgentConfig, StudioRun, StudioWorkflow } from "@orca/shared";

const TOKEN_KEY = "orca-studio.token";
const USER_KEY = "orca-studio.user";

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

// ---- Agent configs ----

export interface AgentConfigInput {
  name: string;
  systemPrompt: string;
  model: string;
  tools?: string[];
}

export const agentConfigs = {
  list: () => api.get<StudioAgentConfig[]>("/api/v1/studio/agents"),
  get: (id: string) => api.get<StudioAgentConfig>(`/api/v1/studio/agents/${id}`),
  create: (input: AgentConfigInput) => api.post<StudioAgentConfig>("/api/v1/studio/agents", input),
  update: (id: string, input: Partial<AgentConfigInput>) => api.put<StudioAgentConfig>(`/api/v1/studio/agents/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/v1/studio/agents/${id}`),
  run: (id: string, input: string) => api.post<StudioRun>(`/api/v1/studio/agents/${id}/run`, { input }),
};

// ---- Workflows ----

export interface WorkflowInput {
  name: string;
  steps: { agentConfigId: string; label?: string }[];
}

export const workflows = {
  list: () => api.get<StudioWorkflow[]>("/api/v1/studio/workflows"),
  get: (id: string) => api.get<StudioWorkflow>(`/api/v1/studio/workflows/${id}`),
  create: (input: WorkflowInput) => api.post<StudioWorkflow>("/api/v1/studio/workflows", input),
  update: (id: string, input: Partial<WorkflowInput>) => api.put<StudioWorkflow>(`/api/v1/studio/workflows/${id}`, input),
  remove: (id: string) => api.delete<void>(`/api/v1/studio/workflows/${id}`),
  run: (id: string, input: string) => api.post<StudioRun>(`/api/v1/studio/workflows/${id}/run`, { input }),
};

// ---- Runs ----

export const runs = {
  list: () => api.get<StudioRun[]>("/api/v1/studio/runs"),
  get: (id: string) => api.get<StudioRun>(`/api/v1/studio/runs/${id}`),
};

export type { StudioAgentConfig, StudioRun, StudioWorkflow };
