import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Integration test config — runs against a real local Supabase instance.
 *
 * These tests verify the actual route handlers against a live database with
 * migrations applied, catching the class of bugs where an RPC exists in pgTAP
 * but the handler calls it with wrong parameters or expects a different shape.
 *
 * Prerequisites:
 *   1. supabase start
 *   2. npm run test:integration
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
