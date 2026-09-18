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

export interface FsnSummary {
  fsn: string;
  totalRemaining: number;
  darkstoreCount: number;
}

export interface FsnListResponse {
  demandBatchId: string;
  fsns: FsnSummary[];
}

export interface LockRow {
  fsn: string;
  labour_id: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
}

export interface LockHeldBy {
  labourId: string;
  labourName: string;
  expiresAt: string;
}

export interface DarkstoreRow {
  darkstoreId: string;
  qtyRequired: number;
  qtyBatched: number;
  remaining: number;
}

export interface DarkstoreListResponse {
  demandBatchId: string;
  fsn: string;
  darkstores: DarkstoreRow[];
}

export interface BatchSubmissionInput {
  darkstoreId: string;
  qtyBatched: number;
  clientRequestId: string;
}

export interface BatchSubmissionResult {
  darkstoreId: string;
  clientRequestId: string;
  status: "accepted" | "duplicate" | "rejected";
  reason?: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  heldBy?: LockHeldBy;
}
