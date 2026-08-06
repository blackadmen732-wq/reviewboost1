import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["line"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command:
      "./node_modules/node/bin/node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    env: {
      NEXT_PUBLIC_USE_CUSTOMER_FIXTURES: "true",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
