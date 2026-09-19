export interface AuthenticatedUser {
  id: string;
  name: string;
  username: string;
  role: "labour" | "supervisor" | "admin";
}

export interface LoginResponse {
  token: string;
  user: AuthenticatedUser;
}

export interface DashboardSummary {
  latestIngestion: {
    batchId: string;
    filename: string;
    status: string;
    totalRows: number;
    validRows: number;
    rejectedRows: number;
    createdAt: string;
  } | null;
  completion: {
    demandBatchId: string;
    totalRequired: number;
    totalBatched: number;
    percentComplete: number;
  } | null;
  activeLockCount: number;
}

export interface DemandBatch {
  id: string;
  source_filename: string;
  status: "processing" | "completed" | "completed_with_errors" | "failed";
  total_rows: number;
  valid_rows: number;
  rejected_rows: number;
  created_at: string;
  completed_at: string | null;
}

export interface DemandException {
  row_number: number;
  raw_row: Record<string, string | undefined>;
  reason: string;
  created_at: string;
}

export interface IngestResult {
  demandBatchId: string;
  status: "completed" | "completed_with_errors" | "failed";
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  fileLevelError?: string;
}

export interface FsnSummary {
  fsn: string;
  totalRemaining: number;
  darkstoreCount: number;
}

export interface DarkstoreRow {
  darkstoreId: string;
  qtyRequired: number;
  qtyBatched: number;
  batchedOnFlash: number;
  remaining: number;
}

export interface ActiveLock {
  fsn: string;
  labour_id: string;
  labour_name: string;
  acquired_at: string;
  expires_at: string;
}

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: "labour" | "supervisor" | "admin";
  active: boolean;
  created_at: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}
