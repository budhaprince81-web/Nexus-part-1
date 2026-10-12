/**
 * Small typed fetch helpers for the NEXUS API.
 *
 * The generated client covers the original REST contract; these helpers cover
 * the newer provider/agent endpoints without regenerating the client. All
 * requests go through the same BASE_URL so the app works behind the Replit
 * router and behind the local dev proxy alike.
 */

export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly payload: unknown;

  constructor(status: number, message: string, code: string | null, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const record = (payload ?? {}) as Record<string, unknown>;
      const message =
        typeof record.error === 'string'
          ? record.error
          : `Request failed (HTTP ${response.status})`;
      const code = typeof record.code === 'string' ? record.code : null;
      throw new ApiError(response.status, message, code, payload);
    }

    return payload as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(408, 'The request timed out.', 'timeout', null);
    }
    throw new ApiError(0, err instanceof Error ? err.message : 'Network error', 'network', null);
  } finally {
    clearTimeout(timer);
  }
}

export function apiGet<T>(path: string, timeoutMs?: number): Promise<T> {
  return request<T>(path, undefined, timeoutMs);
}

export function apiPost<T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  return request<T>(
    path,
    { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    timeoutMs,
  );
}
