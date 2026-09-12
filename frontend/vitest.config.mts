import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 20_000,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/integration/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "html"],
      include: [
        "features/customer-page/**/*.{ts,tsx}",
        "features/customer-page-designer/**/*.{ts,tsx}",
        "lib/api/**/*.ts",
        "lib/customer-page/**/*.ts",
      ],
    },
  },
});
