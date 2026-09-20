import { apiFetch, apiUpload } from "./client.js";
import type {
  LoginResponse,
  DashboardSummary,
  DashboardMetrics,
  DemandBatch,
  DemandException,
  IngestResult,
  FsnSummary,
  DarkstoreRow,
  ActiveLock,
  AdminUser,
  BulkUserResult,
} from "./types.js";

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/v1/auth/login", { method: "POST", body: { username, password } });
}

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>("/api/v1/admin/dashboard/summary");
}

export function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  return apiFetch<DashboardMetrics>("/api/v1/admin/dashboard/metrics");
}

export function uploadDemandFile(file: File): Promise<IngestResult> {
  return apiUpload<IngestResult>("/api/v1/admin/demand/upload", file);
}

export function uploadSyncFile(file: File): Promise<IngestResult> {
  return apiUpload<IngestResult>("/api/v1/admin/demand/sync-upload", file);
}

export function fetchDemandBatches(): Promise<{ batches: DemandBatch[] }> {
  return apiFetch<{ batches: DemandBatch[] }>("/api/v1/admin/demand/batches");
}

export function fetchDemandExceptions(batchId: string): Promise<{ exceptions: DemandException[] }> {
  return apiFetch<{ exceptions: DemandException[] }>(
    `/api/v1/admin/demand/batches/${encodeURIComponent(batchId)}/exceptions`
  );
}

export function fetchFsnList(): Promise<{ demandBatchId: string; fsns: FsnSummary[] }> {
  return apiFetch("/api/v1/fsns");
}

export function fetchAdminDarkstoresForFsn(
  fsn: string
): Promise<{ demandBatchId: string; fsn: string; darkstores: DarkstoreRow[] }> {
  return apiFetch(`/api/v1/admin/fsns/${encodeURIComponent(fsn)}/darkstores`);
}

export function fetchActiveLocks(): Promise<{ locks: ActiveLock[] }> {
  return apiFetch<{ locks: ActiveLock[] }>("/api/v1/admin/fsns/locks");
}

export function forceUnlock(fsn: string, reason: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/fsns/${encodeURIComponent(fsn)}/force-unlock`, {
    method: "POST",
    body: { reason },
  });
}

export function fetchUsers(): Promise<{ users: AdminUser[] }> {
  return apiFetch<{ users: AdminUser[] }>("/api/v1/admin/users");
}

export function createUser(input: {
  name: string;
  username: string;
  password: string;
  role: "labour" | "supervisor" | "admin";
}): Promise<{ user: AdminUser }> {
  return apiFetch<{ user: AdminUser }>("/api/v1/admin/users", { method: "POST", body: input });
}

export function updateUser(
  id: string,
  input: { active?: boolean; password?: string }
): Promise<{ user: AdminUser }> {
  return apiFetch<{ user: AdminUser }>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function uploadUsersBulkFile(file: File): Promise<BulkUserResult> {
  return apiUpload<BulkUserResult>("/api/v1/admin/users/bulk-upload", file);
}
