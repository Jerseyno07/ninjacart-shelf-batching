/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("fsn_lock_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    fsn: { type: "text", notNull: true },
    labour_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    event_type: { type: "text", notNull: true },
    actor_id: { type: "uuid", references: "users", onDelete: "RESTRICT" },
    reason: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint(
    "fsn_lock_events",
    "fsn_lock_events_event_type_check",
    "CHECK (event_type IN ('acquired', 'heartbeat', 'released', 'expired', 'force_unlocked'))"
  );
  pgm.createIndex("fsn_lock_events", ["fsn", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("fsn_lock_events");
};
