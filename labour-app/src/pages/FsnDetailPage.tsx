import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchDarkstoresForFsn } from "../api/endpoints.js";
import { usePolling } from "../hooks/usePolling.js";
import { OfflineBanner } from "../components/OfflineBanner.js";
import { ConfirmExitDialog } from "../components/ConfirmExitDialog.js";
import { generateId } from "../lib/uuid.js";
import { enqueueAndAttempt } from "../offline/syncQueue.js";
import { setDraftEntry, clearDraftEntry, listDraftEntriesForFsn, clearAllDraftsForFsn } from "../offline/db.js";
import type { LockHeldBy, BatchSubmissionInput } from "../api/types.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const LOCK_WAIT_RETRY_MS = 3_000;

type LockState = "acquiring" | "held" | "conflict" | "offline-waiting" | "error";

export function FsnDetailPage() {
  const { fsn = "" } = useParams<{ fsn: string }>();
  const navigate = useNavigate();

  const [lockState, setLockState] = useState<LockState>("acquiring");
  const [heldBy, setHeldBy] = useState<LockHeldBy | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [pendingDarkstoreIds, setPendingDarkstoreIds] = useState<Set<string>>(new Set());
  const [rowFeedback, setRowFeedback] = useState<Record<string, string>>({});
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const lockHeldRef = useRef(false);

  const { data, lastUpdatedAt, isOffline, refetch } = usePolling(
    () => fetchDarkstoresForFsn(fsn),
    7000
  );

  // Acquire the FSN lock before anything else is shown — see
  // docs/02-adr-001-fsn-level-locking.md. This bypasses the generic offline
  // queue's silent-retry semantics deliberately: opening the darkstore list
  // needs a definitive, structured answer (held / conflict, with who holds
  // it), not a best-effort background retry.
  useEffect(() => {
    let cancelled = false;
    let retryHandle: number;

    async function attempt() {
      const result = await enqueueAndAttempt({
        id: generateId(),
        type: "lock",
        fsn,
        status: "pending",
        createdAt: Date.now(),
        attempts: 0,
      });
      if (cancelled) return;

      if (result.status === "synced") {
        lockHeldRef.current = true;
        setLockState("held");
      } else if (result.status === "rejected") {
        if (result.heldBy) {
          setHeldBy(result.heldBy);
          setLockState("conflict");
        } else {
          setErrorMessage(result.rejectReason ?? "Could not open this FSN");
          setLockState("error");
        }
      } else {
        // Still offline — show a waiting state and keep retrying.
        setLockState("offline-waiting");
        retryHandle = window.setTimeout(attempt, LOCK_WAIT_RETRY_MS);
      }
    }

    void attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(retryHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsn]);

  // Heartbeat while the lock is held and this screen is mounted.
  useEffect(() => {
    if (lockState !== "held") return;
    const handle = window.setInterval(() => {
      void enqueueAndAttempt({
        id: generateId(),
        type: "heartbeat",
        fsn,
        status: "pending",
        createdAt: Date.now(),
        attempts: 0,
      });
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [lockState, fsn]);

  // Release on unmount (covers back-button/nav-away after a confirmed exit).
  useEffect(() => {
    return () => {
      if (lockHeldRef.current) {
        void enqueueAndAttempt({
          id: generateId(),
          type: "release",
          fsn,
          status: "pending",
          createdAt: Date.now(),
          attempts: 0,
        });
      }
    };
  }, [fsn]);

  // Load any drafts left from a previous session on this device.
  useEffect(() => {
    if (lockState !== "held") return;
    void listDraftEntriesForFsn(fsn).then((entries) => {
      const map: Record<string, number> = {};
      for (const entry of entries) map[entry.darkstoreId] = entry.qty;
      setDrafts(map);
    });
  }, [lockState, fsn]);

  const touchedCount = Object.keys(drafts).length;

  const handleQtyChange = useCallback(
    (darkstoreId: string, raw: string) => {
      if (raw === "") {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[darkstoreId];
          return next;
        });
        void clearDraftEntry(fsn, darkstoreId);
        return;
      }
      const qty = Number.parseInt(raw, 10);
      if (Number.isNaN(qty) || qty < 0) return;
      setDrafts((prev) => ({ ...prev, [darkstoreId]: qty }));
      void setDraftEntry(fsn, darkstoreId, qty);
    },
    [fsn]
  );

  const doSubmit = useCallback(async () => {
    const touchedIds = Object.keys(drafts);
    if (touchedIds.length === 0) return;
    setSubmitting(true);
    setPendingDarkstoreIds(new Set(touchedIds));

    const submissions: BatchSubmissionInput[] = touchedIds.map((darkstoreId) => ({
      darkstoreId,
      qtyBatched: drafts[darkstoreId]!,
      clientRequestId: generateId(),
    }));

    const result = await enqueueAndAttempt({
      id: generateId(),
      type: "batch",
      fsn,
      submissions,
      status: "pending",
      createdAt: Date.now(),
      attempts: 0,
    });

    if (result.status === "synced" && result.results) {
      const feedback: Record<string, string> = {};
      for (const r of result.results) {
        if (r.status === "rejected") feedback[r.darkstoreId] = r.reason ?? "Rejected";
      }
      setRowFeedback(feedback);
      // Clear drafts + pending markers only for rows that weren't rejected —
      // a rejected row stays editable so the labourer can amend it.
      const acceptedIds = touchedIds.filter((id) => !feedback[id]);
      for (const id of acceptedIds) await clearDraftEntry(fsn, id);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of acceptedIds) delete next[id];
        return next;
      });
      refetch();
    }
    // If still 'pending' (offline), leave drafts + pending markers in place —
    // the background sync loop will resolve this on the next tick, and the
    // per-action idempotency key means a later retry is a safe no-op even
    // if this one secretly landed.

    setPendingDarkstoreIds(new Set());
    setSubmitting(false);
  }, [drafts, fsn, refetch]);

  const requestExit = useCallback(() => {
    if (touchedCount > 0) {
      setShowExitDialog(true);
    } else {
      navigate("/fsns");
    }
  }, [touchedCount, navigate]);

  const handleSubmitAndExit = useCallback(async () => {
    setShowExitDialog(false);
    await doSubmit();
    navigate("/fsns");
  }, [doSubmit, navigate]);

  const handleDiscardAndExit = useCallback(async () => {
    setShowExitDialog(false);
    await clearAllDraftsForFsn(fsn);
    setDrafts({});
    navigate("/fsns");
  }, [fsn, navigate]);

  if (lockState === "acquiring") {
    return <CenteredMessage>Opening {fsn}…</CenteredMessage>;
  }

  if (lockState === "offline-waiting") {
    return (
      <CenteredMessage>
        Waiting for connection to open {fsn}…
        <button className="mt-4 text-sm underline text-gray-400" onClick={() => navigate("/fsns")}>
          Go back
        </button>
      </CenteredMessage>
    );
  }

  if (lockState === "conflict") {
    return (
      <CenteredMessage>
        <p className="mb-2">{fsn} is currently locked by {heldBy?.labourName ?? "another user"}.</p>
        <p className="text-sm text-gray-400 mb-4">It will free up shortly.</p>
        <button className="text-sm underline text-gray-400" onClick={() => navigate("/fsns")}>
          Go back
        </button>
      </CenteredMessage>
    );
  }

  if (lockState === "error") {
    return (
      <CenteredMessage>
        <p className="mb-4 text-red-400">{errorMessage}</p>
        <button className="text-sm underline text-gray-400" onClick={() => navigate("/fsns")}>
          Go back
        </button>
      </CenteredMessage>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <OfflineBanner isOffline={isOffline} lastUpdatedAt={lastUpdatedAt} />

      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <button className="text-sm underline text-gray-400" onClick={requestExit}>
          ← Back
        </button>
        <h1 className="text-lg font-bold">{fsn}</h1>
        <div className="w-12" />
      </header>

      <ul className="flex-1 overflow-y-auto divide-y divide-gray-800">
        {data?.darkstores.map((ds) => {
          const isPending = pendingDarkstoreIds.has(ds.darkstoreId);
          const feedback = rowFeedback[ds.darkstoreId];
          return (
            <li key={ds.darkstoreId} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex-1">
                <p className="font-medium">{ds.darkstoreId}</p>
                <p className="text-xs text-gray-400">
                  {ds.qtyBatched} / {ds.qtyRequired} batched · {ds.remaining} remaining
                </p>
                {feedback && <p className="text-xs text-red-400 mt-1">{feedback}</p>}
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={ds.remaining}
                disabled={isPending || ds.remaining <= 0}
                value={drafts[ds.darkstoreId] ?? ""}
                onChange={(e) => handleQtyChange(ds.darkstoreId, e.target.value)}
                placeholder={ds.remaining <= 0 ? "done" : "0"}
                className="w-20 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-right disabled:opacity-50"
              />
            </li>
          );
        })}
      </ul>

      <footer className="p-4 border-t border-gray-800">
        <button
          disabled={touchedCount === 0 || submitting}
          onClick={() => void doSubmit()}
          className="w-full py-3 rounded-lg bg-emerald-600 active:bg-emerald-700 disabled:opacity-40 font-semibold"
        >
          {submitting ? "Submitting…" : `Submit${touchedCount > 0 ? ` (${touchedCount})` : ""}`}
        </button>
      </footer>

      {showExitDialog && (
        <ConfirmExitDialog
          touchedCount={touchedCount}
          onSubmitAndExit={() => void handleSubmitAndExit()}
          onDiscardAndExit={() => void handleDiscardAndExit()}
          onCancel={() => setShowExitDialog(false)}
        />
      )}
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-6 text-center">{children}</div>;
}
