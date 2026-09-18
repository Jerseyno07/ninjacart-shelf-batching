import type { ApiErrorBody } from "./types.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: ApiErrorBody
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the request never reached the server — the caller should
 * queue the action for the offline sync loop rather than surface a hard error. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        // Only set Content-Type when there's actually a body — Fastify's
        // JSON body parser rejects an empty body outright if this header
        // is present (found by actually clicking through the app: every
        // bodyless POST, e.g. lock/heartbeat/release, failed with 400
        // "Body cannot be empty when content-type is set to
        // 'application/json'").
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    throw new NetworkError((err as Error).message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(data.message ?? "Request failed", response.status, data);
  }

  return data as T;
}
