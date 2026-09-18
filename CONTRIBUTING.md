# Contributing

This repo has an external collaborator with push access. This document is the review process in writing, not a verbal agreement — treat it as binding.

## Local setup

TBD in detail once the backend scaffold lands (tracked in `docs/06-incident-decisions-log.md`). At minimum you'll need:
- Node.js (LTS)
- A Neon Postgres connection string in a local, untracked `.env` — **never** commit credentials, even to this private repo
- `npm install` in `backend/`, `labour-app/`, and `admin-panel/` respectively

## Branch naming

`type/short-description`, e.g. `feat/fsn-lock-acquire`, `fix/ledger-race`, `docs/deployment-runbook`. Types match commit prefixes: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.

## Commit style

Conventional commits (`feat:`, `fix:`, `chore:`, …). Explain *why* in the body when the *what* isn't obvious from the diff alone.

## Pull requests — the review gate

**Nothing merges to `main` without the repo owner's explicit approval, after seeing a review summary.** Concretely:

1. `main` is branch-protected: no direct pushes, PR required, at least one required review before merge.
2. Every PR must use the pull request template (`.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`), which includes a checklist against the concurrency/data-model rules in `docs/02-adr-001-fsn-level-locking.md` and `docs/03-data-model.md` (lock grain respected, ledger stays append-only, every write path uses atomic check-then-insert, idempotency keys present on client-submitted actions).
3. CI runs lint/typecheck/test/build on every PR (see `.github/workflows/ci.yml`) — a red CI is a blocker, not a suggestion.
4. Before merge, the code gets reviewed for correctness and adherence to the rules above (by Claude Code / a review agent, or the repo owner directly) and a summary of the diff + findings is presented to the repo owner. The repo owner gives explicit go-ahead — a green CI and an approving review are necessary but not sufficient; the owner's explicit sign-off is required on top.
5. Squash-merge preferred, so `main` history stays one commit per logical change.

## What "correctness and adherence" means in review, concretely

- Does every write to `batching_events` go through the atomic re-check-then-insert described in `docs/03-data-model.md`, or does anything read-then-write?
- Does any change touch `fsn_locks` in a way that isn't the single atomic `INSERT ... ON CONFLICT ... WHERE expires_at < now()` statement?
- Do new client-submitted actions carry a `client_request_id` idempotency key, unique-constrained server-side?
- Does anything treat `demand.qty_required` or ledger totals as mutable fields rather than deriving remaining quantity from the append-only log?
- Do migrations ship with a working down-migration in the same PR?
