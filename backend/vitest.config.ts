import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15000, // integration tests hit a real Neon branch over the network
    // Integration test files all share one live database and some (e.g.
    // dashboardService's "latest ingestion batch") assert on global state,
    // not just their own rows — running files in parallel risks one file's
    // insert winning a race against another's "latest" read. Sequential is
    // slower but correct; these are integration tests, not a unit-test
    // suite where speed matters most.
    fileParallelism: false,
    env: {
      // Dummy defaults so config.ts's env validation doesn't throw at import
      // time when a test file is collected but its describe block is
      // skipped (no TEST_DATABASE_URL). Never used to actually connect —
      // integration tests use TEST_DATABASE_URL/pg.Pool directly.
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-not-used-do-not-rely-on-this-value",
    },
  },
});
