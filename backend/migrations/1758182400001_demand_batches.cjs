/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("demand_batches", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    source_filename: { type: "text", notNull: true },
    uploaded_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    status: { type: "text", notNull: true, default: "processing" },
    total_rows: { type: "integer", notNull: true, default: 0 },
    valid_rows: { type: "integer", notNull: true, default: 0 },
    rejected_rows: { type: "integer", notNull: true, default: 0 },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    completed_at: { type: "timestamptz" },
  });

  pgm.addConstraint(
    "demand_batches",
    "demand_batches_status_check",
    "CHECK (status IN ('processing', 'completed', 'completed_with_errors', 'failed'))"
  );
  pgm.createIndex("demand_batches", "status");
  pgm.createIndex("demand_batches", ["created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("demand_batches");
};
