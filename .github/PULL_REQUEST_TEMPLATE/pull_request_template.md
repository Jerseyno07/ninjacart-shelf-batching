## What & why



## Checklist against `docs/02-adr-001-fsn-level-locking.md` and `docs/03-data-model.md`

- [ ] Any `fsn_locks` write is the single atomic `INSERT ... ON CONFLICT (fsn) DO UPDATE ... WHERE expires_at < now()` statement — no read-then-write on lock state.
- [ ] Any `batching_events` write re-checks `remaining >= qty_batched` inside the same transaction as the insert (atomic check-then-insert), independent of lock state.
- [ ] `demand.qty_required` / ledger totals are never mutated in place — remaining quantity is always derived from `batching_events`.
- [ ] New client-submitted actions carry a `client_request_id` idempotency key, unique-constrained server-side.
- [ ] Migrations (if any) ship with a tested down-migration in this same PR.
- [ ] Docs updated in this PR (not deferred): `docs/06-incident-decisions-log.md` and/or `CHANGELOG.md` if this changes behavior worth recording.

## Testing

How was this verified? (unit/integration tests added, manual steps, etc.)

## For the reviewer

Summarize findings here before requesting the repo owner's sign-off — nothing merges without their explicit approval.
