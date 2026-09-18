# labour-app

Mobile-first, offline-tolerant PWA for warehouse labour. React + Vite + Tailwind. See `../docs/00-overview.md` (partial-entry/exit behavior) and `../docs/02-adr-001-fsn-level-locking.md` before touching lock or offline-queue code.

## Setup

```bash
npm install
cp .env.example .env   # set VITE_API_BASE_URL to the backend
npm run dev
```

## How this implements the offline model (docs/01-architecture.md)

- `src/offline/db.ts` — IndexedDB (`idb`) store for queued actions (lock/heartbeat/release/batch) and a separate store for in-progress draft entries keyed by `(fsn, darkstoreId)`.
- `src/offline/syncQueue.ts` — writes an action to the queue before any network call, makes one immediate attempt, and retries pending ones on an interval + on the `online` event. Every retry reuses the same idempotency key, so a submission the server already accepted comes back as a safe `duplicate`.
- **Lock acquire is a deliberate exception to "just queue it blindly":** it still goes through the queue (for consistency and the audit trail), but the FSN screen waits for a definitive synced/rejected outcome before showing the darkstore list — see the comment in `FsnDetailPage.tsx`. Opening the list is a UX access gate per ADR-001 and needs a real answer, not an optimistic guess; batch submissions don't have this problem because they're safe to retry blindly (idempotency key + atomic check-then-insert on the server).
- `usePolling` (list screens) keeps showing the last-known snapshot with a timestamp on a failed poll, never a blank screen.

## Known scope trims (flagging, not hiding)

- **Back navigation** is the app's own header "← Back" button, not an interception of the phone's native back gesture/browser back button. Functionally equivalent for this installed-PWA context, but if the collaborator adds native-back interception later, it needs to trigger the same `requestExit()` path in `FsnDetailPage.tsx`.
- Icons in `public/icons/` are placeholder solid-color PNGs, not real artwork.
- Not yet tested against a running backend (no Neon connection was available while this was built) — needs an end-to-end pass once the backend is live.
