import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
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
