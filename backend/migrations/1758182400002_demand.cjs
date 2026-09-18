/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("demand", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    demand_batch_id: { type: "uuid", notNull: true, references: "demand_batches", onDelete: "CASCADE" },
    fsn: { type: "text", notNull: true },
    darkstore_id: { type: "text", notNull: true },
    batch_type: { type: "text", notNull: true, default: "shelf" },
    qty_required: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("demand", "demand_qty_required_positive", "CHECK (qty_required > 0)");
  pgm.addConstraint(
    "demand",
    "demand_unique_row",
    "UNIQUE (fsn, darkstore_id, batch_type, demand_batch_id)"
  );
  pgm.createIndex("demand", ["fsn", "batch_type", "demand_batch_id"]);
  pgm.createIndex("demand", ["darkstore_id", "demand_batch_id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("demand");
};
