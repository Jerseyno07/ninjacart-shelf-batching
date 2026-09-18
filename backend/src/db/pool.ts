import { Pool } from "pg";
import { config } from "../config.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
});

pool.on("error", (err) => {
  // A dropped idle connection must not crash the process — Postgres/network
  // blips are routine on the connection pool, not an application error.
  // eslint-disable-next-line no-console
  console.error("Unexpected pg pool error", err);
});
