/* eslint-disable */
// See docs/02-adr-001-fsn-level-locking.md — this table is the whole ADR.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("fsn_locks", {
    fsn: { type: "text", primaryKey: true },
    labour_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    acquired_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    expires_at: { type: "timestamptz", notNull: true },
    released_at: { type: "timestamptz" },
  });

  pgm.createIndex("fsn_locks", "expires_at");
};

exports.down = (pgm) => {
  pgm.dropTable("fsn_locks");
};
