import { openDB, type IDBPDatabase } from "idb";
import type { BatchSubmissionInput, BatchSubmissionResult, LockHeldBy } from "../api/types.js";

/**
 * Every lock-acquire and submit action is written here BEFORE the network
 * call fires (docs/01-architecture.md offline model), keyed by the same
 * client-generated idempotency id used server-side. A background sync loop
 * (syncQueue.ts) retries these when connectivity returns.
 */

export type QueuedActionType = "lock" | "heartbeat" | "release" | "batch";
export type QueuedActionStatus = "pending" | "synced" | "rejected";

export interface QueuedAction {
  id: string; // == clientRequestId for 'batch'; a fresh uuid for others
  type: QueuedActionType;
  fsn: string;
  submissions?: BatchSubmissionInput[]; // only for 'batch'
  status: QueuedActionStatus;
  rejectReason?: string;
  heldBy?: LockHeldBy; // populated when a 'lock' action is rejected as LOCK_HELD
  results?: BatchSubmissionResult[]; // per-row outcomes for a synced 'batch' action
  createdAt: number;
  attempts: number;
}

const DB_NAME = "shelf-batching-labour";
const DB_VERSION = 1;
const STORE_NAME = "queued_actions";
const DRAFT_STORE_NAME = "draft_entries";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("fsn", "fsn");

        const drafts = db.createObjectStore(DRAFT_STORE_NAME, { keyPath: "key" });
        drafts.createIndex("fsn", "fsn");
      },
    });
  }
  return dbPromise;
}

/**
 * Local cache of in-progress, not-yet-submitted entries, keyed by
 * (fsn, darkstoreId) — see docs/00-overview.md partial-entry behavior.
 * Untouched rows are simply absent here, never written as 0.
 */
export interface DraftEntry {
  key: string; // `${fsn}::${darkstoreId}`
  fsn: string;
  darkstoreId: string;
  qty: number;
}

function draftKey(fsn: string, darkstoreId: string): string {
  return `${fsn}::${darkstoreId}`;
}

export async function setDraftEntry(fsn: string, darkstoreId: string, qty: number): Promise<void> {
  const db = await getDb();
  await db.put(DRAFT_STORE_NAME, { key: draftKey(fsn, darkstoreId), fsn, darkstoreId, qty });
}

export async function clearDraftEntry(fsn: string, darkstoreId: string): Promise<void> {
  const db = await getDb();
  await db.delete(DRAFT_STORE_NAME, draftKey(fsn, darkstoreId));
}

export async function listDraftEntriesForFsn(fsn: string): Promise<DraftEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex(DRAFT_STORE_NAME, "fsn", fsn);
}

export async function clearAllDraftsForFsn(fsn: string): Promise<void> {
  const db = await getDb();
  const drafts = await listDraftEntriesForFsn(fsn);
  const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
  await Promise.all(drafts.map((d) => tx.store.delete(d.key)));
  await tx.done;
}

export async function enqueueAction(action: QueuedAction): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, action);
}

export async function listPendingActions(): Promise<QueuedAction[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE_NAME, "status", "pending");
}

export async function updateActionStatus(
  id: string,
  status: QueuedActionStatus,
  rejectReason?: string,
  heldBy?: LockHeldBy,
  results?: BatchSubmissionResult[]
): Promise<void> {
  const db = await getDb();
  const existing = await db.get(STORE_NAME, id);
  if (!existing) return;
  await db.put(STORE_NAME, { ...existing, status, rejectReason, heldBy, results });
}

export async function incrementAttempts(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get(STORE_NAME, id);
  if (!existing) return;
  await db.put(STORE_NAME, { ...existing, attempts: existing.attempts + 1 });
}

export async function listActionsForFsn(fsn: string): Promise<QueuedAction[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE_NAME, "fsn", fsn);
}

export async function getAction(id: string): Promise<QueuedAction | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, id);
}
