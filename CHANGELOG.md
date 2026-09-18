# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Entries explain *why*, not just *what* — the diff already shows the what.

## [Unreleased]

### Added
- Repo scaffold: `CLAUDE.md`, docs vault (`docs/`), `CONTRIBUTING.md`, CI workflow, PR template — established before any feature code, per project kickoff requirements around auditability for a ₹450cr/year business line.
- ADR-001: FSN-level claim/lease locking for Shelf Batching (drafted, pending approval) — see `docs/02-adr-001-fsn-level-locking.md`. Documents why the lock is scoped to the whole FSN rather than per-darkstore-cell, since this is the decision most likely to be revisited later.
- Draft data model and demand-ingestion contract (pending approval) — see `docs/03-data-model.md`, `docs/04-ingestion-contract.md`.
