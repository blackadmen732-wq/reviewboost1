import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 120_000,
  workers: 1,
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
    timeout: 15_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command:
      "./node_modules/node/bin/node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    env: {
      NEXT_PUBLIC_USE_CUSTOMER_FIXTURES: "true",
    },
    url: `http://127.0.0.1:${port}/q/fixture-valid`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
