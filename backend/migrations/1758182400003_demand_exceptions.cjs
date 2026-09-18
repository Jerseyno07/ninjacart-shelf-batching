/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("demand_exceptions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    demand_batch_id: { type: "uuid", notNull: true, references: "demand_batches", onDelete: "CASCADE" },
    raw_row: { type: "jsonb", notNull: true },
    row_number: { type: "integer", notNull: true },
    reason: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("demand_exceptions", "demand_batch_id");
};

exports.down = (pgm) => {
  pgm.dropTable("demand_exceptions");
};
