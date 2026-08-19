import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  globalSetup: "./tests/playwright/partner-management.setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3195",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3195",
    url: "http://127.0.0.1:3195/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      NEXTAUTH_URL: "http://127.0.0.1:3195",
      NEXTAUTH_SECRET: "local-partner-management-playwright-secret",
      NODE_ENV: "test",
    },
  },
});
