# admin-panel

Desktop-first admin/supervisor web app. React + Vite + Tailwind. No offline queue or service worker here (unlike `labour-app`) — admins work at a desk on a real connection, so the added complexity isn't justified.

## Setup

```bash
npm install
cp .env.example .env   # set VITE_API_BASE_URL to the backend
npm run dev
```

## Pages

- **Dashboard** — overall completion %, active lock count, latest ingestion status (`GET /api/v1/admin/dashboard/summary`)
- **Demand Upload** — upload a CSV, see ingestion history, view/download rejected rows per batch
- **FSN Completion** — read-only, drills into darkstore-level breakdown per FSN. Uses `GET /api/v1/admin/fsns/:fsn/darkstores`, which deliberately does **not** require holding the FSN lock (unlike the labour app's equivalent) — a supervisor watches progress without taking the lock away from whoever's working it.
- **Active Locks** — live view of currently held locks, with a force-unlock action (reason required, fully audited server-side)
- **Users** (admin role only — hidden from supervisors in the nav and gated by `AdminOnlyRoute`) — create, list, deactivate/reactivate accounts

## Role handling

Login rejects `labour` accounts client-side with a clear message (`AuthContext.tsx`) — the backend would reject every subsequent call with 403 anyway, but this avoids a labourer staring at a broken dashboard. `supervisor` accounts can do everything except user management, which `AdminOnlyRoute` and the nav both gate to `admin` only.

## Known scope trims

- Tested end-to-end against a live backend in a real browser — found and fixed a `@fastify/cors` missing-`PATCH`-method bug in the process. See `docs/08-testing-log.md` for the full account.
- FSN Completion's list comes from `GET /api/v1/fsns`, which only returns FSNs with outstanding remaining demand (matches the labour app's list). A fully-complete FSN drops off this table rather than showing 100% — acceptable for this pass, flagged rather than silently accepted as complete coverage.
- No automated component/unit tests, same as `labour-app` — coverage is lint/typecheck/build plus the one (real, bug-catching) manual browser session, not a repeatable automated suite.
