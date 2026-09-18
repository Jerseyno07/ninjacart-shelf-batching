/* eslint-disable */
// The ledger. Append-only, on purpose — see docs/03-data-model.md. Never add
// an UPDATE/DELETE path against this table in application code.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("batching_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    demand_batch_id: { type: "uuid", notNull: true, references: "demand_batches", onDelete: "RESTRICT" },
    fsn: { type: "text", notNull: true },
    darkstore_id: { type: "text", notNull: true },
    batch_type: { type: "text", notNull: true, default: "shelf" },
    qty_batched: { type: "integer", notNull: true },
    labour_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    client_request_id: { type: "uuid", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("batching_events", "batching_events_qty_positive", "CHECK (qty_batched > 0)");
  pgm.addConstraint(
    "batching_events",
    "batching_events_client_request_id_unique",
    "UNIQUE (client_request_id)"
  );
  pgm.createIndex("batching_events", ["fsn", "darkstore_id", "demand_batch_id"]);
  pgm.createIndex("batching_events", ["labour_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("batching_events");
};
