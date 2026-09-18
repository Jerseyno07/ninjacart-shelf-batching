import {
  listPendingActions,
  updateActionStatus,
  incrementAttempts,
  enqueueAction,
  getAction,
  type QueuedAction,
} from "./db.js";
import { acquireLock, heartbeatLock, releaseLock, submitBatch } from "../api/endpoints.js";
import { ApiError, NetworkError } from "../api/client.js";
import type { BatchSubmissionResult } from "../api/types.js";

/**
 * Retries queued actions when connectivity returns. Every action carries the
 * same idempotency key on every retry — a submission the server already
 * accepted comes back as a safe 'duplicate', not a double-count.
 */
let syncing = false;

export async function runSyncPass(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await listPendingActions();
    for (const action of pending) {
      await syncOne(action);
    }
  } finally {
    syncing = false;
  }
}

async function syncOne(action: QueuedAction): Promise<void> {
  try {
    await incrementAttempts(action.id);

    let results: BatchSubmissionResult[] | undefined;
    switch (action.type) {
      case "lock":
        await acquireLock(action.fsn);
        break;
      case "heartbeat":
        await heartbeatLock(action.fsn);
        break;
      case "release":
        await releaseLock(action.fsn);
        break;
      case "batch":
        if (action.submissions) {
          const response = await submitBatch(action.fsn, action.submissions);
          results = response.results;
        }
        break;
    }

    await updateActionStatus(action.id, "synced", undefined, undefined, results);
  } catch (err) {
    if (err instanceof NetworkError) {
      // Still offline / request never landed — leave it pending, try again
      // on the next pass. Never mark this as rejected.
      return;
    }
    if (err instanceof ApiError) {
      // Server saw it and said no (e.g. lock conflict, insufficient
      // remaining) — this is a real terminal outcome, surface it to the UI.
      await updateActionStatus(action.id, "rejected", err.message, err.body.heldBy);
      return;
    }
    throw err;
  }
}

/**
 * Writes the action to the queue (before any network call, per the offline
 * model) then makes one immediate attempt — so the common "we're online"
 * case resolves right away instead of waiting for the next background tick.
 * If offline, the action is left 'pending' for the background loop to pick
 * up later; returns whatever the current stored state is.
 */
export async function enqueueAndAttempt(action: QueuedAction): Promise<QueuedAction> {
  await enqueueAction(action);
  await syncOne(action);
  const latest = await getAction(action.id);
  return latest ?? action;
}

let syncLoopHandle: number | null = null;

export function startSyncLoop(intervalMs = 5000): () => void {
  const tick = () => {
    void runSyncPass();
  };
  window.addEventListener("online", tick);
  syncLoopHandle = window.setInterval(tick, intervalMs);
  tick();

  return () => {
    window.removeEventListener("online", tick);
    if (syncLoopHandle) window.clearInterval(syncLoopHandle);
  };
}
