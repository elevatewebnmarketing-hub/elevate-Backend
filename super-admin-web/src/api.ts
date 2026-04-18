const TOKEN_KEY = "elevate_super_admin_token";
const EMAIL_KEY = "elevate_super_admin_email";

export const SESSION_LOST_EVENT = "elevate-super-admin:session-lost";

export function getApiBase(): string {
  const u = import.meta.env.VITE_API_BASE_URL;
  if (typeof u === "string" && u.length > 0) {
    return u.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }
  throw new Error("Set VITE_API_BASE_URL for production builds");
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null): void {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getSuperAdminEmail(): string | null {
  return sessionStorage.getItem(EMAIL_KEY);
}

export function setSuperAdminEmail(email: string | null): void {
  if (email) sessionStorage.setItem(EMAIL_KEY, email.toLowerCase());
  else sessionStorage.removeItem(EMAIL_KEY);
}

/**
 * Clear token + email. When `notify` is true (default), dispatches `SESSION_LOST_EVENT`
 * (e.g. expired session). Use `notify: false` for explicit sign-out to avoid duplicate toasts.
 */
export function clearSuperAdminSession(notify = true): void {
  setToken(null);
  setSuperAdminEmail(null);
  if (notify && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT));
  }
}

export type ApiErrorBody = {
  error?: string;
  message?: string;
  hint?: string;
  code?: string;
};

/** Public `GET /v1/health` — no auth. Used by the dashboard for integration flags. */
export type HealthResponse = {
  status?: string;
  service?: string;
  apiVersion?: string;
  time?: string;
  uptimeSeconds?: number;
  integrations?: { cloudinary?: boolean; email?: boolean };
};

export async function fetchPublicHealth(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${getApiBase()}/v1/health`);
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

export type ApiFetchOptions = RequestInit & {
  json?: unknown;
  /**
   * When true, a 401 response does not clear the session.
   * Use for password re-check (`/v1/super-admin/auth/login`) while already logged in.
   */
  skipSessionResetOn401?: boolean;
};

export async function apiFetch<T>(
  path: string,
  init: ApiFetchOptions = {},
): Promise<T> {
  const base = getApiBase();
  const token = getToken();
  const headers = new Headers(init.headers);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const body = init.json !== undefined ? JSON.stringify(init.json) : init.body;
  const res = await fetch(`${base}${path}`, { ...init, headers, body });
  if (res.status === 204) {
    return undefined as T;
  }
  if (
    res.status === 401 &&
    getToken() &&
    !init.skipSessionResetOn401
  ) {
    clearSuperAdminSession();
    throw new Error("Session expired or unauthorized — please sign in again.");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { error: "invalid_json", message: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = data as ApiErrorBody;
    const parts = [
      err.message,
      err.hint,
      err.code ? `(${err.code})` : undefined,
      err.error,
    ].filter(Boolean);
    const msg =
      parts.length > 0 ? parts.join(" — ") : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}
