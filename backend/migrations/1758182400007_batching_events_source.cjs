/* eslint-disable */
// Distinguishes real labour submissions from sync-import-seeded ledger rows
// (docs/04-ingestion-contract.md "Sync existing progress"). Needed because
// labour_id alone can't tell them apart -- a sync entry's labour_id is
// whichever admin ran the sync, which isn't otherwise distinguishable from
// an admin account genuinely holding a lock and batching for real.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("batching_events", {
    source: { type: "text", notNull: true, default: "labour" },
  });
  pgm.addConstraint(
    "batching_events",
    "batching_events_source_check",
    "CHECK (source IN ('labour', 'sync'))"
  );
};

exports.down = (pgm) => {
  pgm.dropConstraint("batching_events", "batching_events_source_check");
  pgm.dropColumn("batching_events", "source");
};
