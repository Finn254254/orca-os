const TOKEN_KEY = "orca.token";
const USER_KEY = "orca.user";

export interface SessionUser {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
}

// In dev, Vite proxies /api and /ws to Orca API (see vite.config.ts). In a
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

export function wsUrl(): string {
  if (BASE_URL) {
    return `${BASE_URL.replace(/^http/, "ws")}/ws`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const res = await api.post<{ token: string; user: SessionUser }>("/api/v1/auth/login", { username, password });
  storeSession(res.token, res.user);
  return res.user;
}
