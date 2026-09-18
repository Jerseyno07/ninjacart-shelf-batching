import { apiFetch } from "./client.js";
import type {
  LoginResponse,
  FsnListResponse,
  DarkstoreListResponse,
  LockRow,
  BatchSubmissionInput,
  BatchSubmissionResult,
} from "./types.js";

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/v1/auth/login", { method: "POST", body: { username, password } });
}

export function fetchFsnList(): Promise<FsnListResponse> {
  return apiFetch<FsnListResponse>("/api/v1/fsns");
}

export function acquireLock(fsn: string): Promise<{ lock: LockRow }> {
  return apiFetch<{ lock: LockRow }>(`/api/v1/fsns/${encodeURIComponent(fsn)}/lock`, { method: "POST" });
}

export function heartbeatLock(fsn: string): Promise<{ lock: LockRow }> {
  return apiFetch<{ lock: LockRow }>(`/api/v1/fsns/${encodeURIComponent(fsn)}/heartbeat`, {
    method: "POST",
  });
}

export function releaseLock(fsn: string): Promise<void> {
  return apiFetch<void>(`/api/v1/fsns/${encodeURIComponent(fsn)}/release`, { method: "POST" });
}

export function fetchDarkstoresForFsn(fsn: string): Promise<DarkstoreListResponse> {
  return apiFetch<DarkstoreListResponse>(`/api/v1/fsns/${encodeURIComponent(fsn)}/darkstores`);
}

export function submitBatch(
  fsn: string,
  submissions: BatchSubmissionInput[]
): Promise<{ results: BatchSubmissionResult[] }> {
  return apiFetch<{ results: BatchSubmissionResult[] }>(`/api/v1/fsns/${encodeURIComponent(fsn)}/batch`, {
    method: "POST",
    body: { submissions },
  });
}
