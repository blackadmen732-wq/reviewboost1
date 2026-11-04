import react from "@vitejs/plugin-react";
import { transformWithEsbuild, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Source from the Expo app, compiled without the Expo app's tsconfig.
 *
 * tests/unit/nfc-parity.test.ts imports apps/mobile/lib/nfc-scenes.ts to prove
 * the web sheet and the native screen say the same things. Left to itself,
 * Vite compiles that file against apps/mobile/tsconfig.json, which extends
 * `expo/tsconfig.base` — a package the frontend never installs — so the suite
 * failed to load at all, locally and in CI. What the tests import from there
 * is plain TypeScript constants, which need no project settings; a fixed empty
 * tsconfig compiles them the same everywhere. Frontend files are untouched:
 * they still go through Vite's own esbuild step with frontend/tsconfig.json.
 */
const MOBILE_SOURCE = /[\\/]apps[\\/]mobile[\\/].+\.tsx?$/;

function mobileSource(): Plugin {
  return {
    name: "reviewboost:mobile-source",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!MOBILE_SOURCE.test(file)) return null;
      const result = await transformWithEsbuild(code, file, {
        loader: file.endsWith("x") ? "tsx" : "ts",
        // A string skips the tsconfig lookup that fails on `expo/tsconfig.base`.
        tsconfigRaw: "{}",
      });
      return { code: result.code, map: JSON.stringify(result.map) };
    },
  };
}

export default defineConfig({
  plugins: [mobileSource(), react(), tsconfigPaths()],
  // Vite's own TypeScript step keeps its defaults for everything else.
  esbuild: { exclude: [MOBILE_SOURCE, /\.js$/] },
  test: {
    environment: "jsdom",
    globals: true,
    testTimeout: 20_000,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
      include: ["features/customer-flow/**/*.{ts,tsx}", "lib/api/**/*.ts"],
    },
  },
});
