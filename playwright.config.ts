import { defineConfig, devices } from "@playwright/test";

import {
  createSanitizedTestServerEnv,
  testDatabaseUrl,
} from "./scripts/require-test-database";

const port = 3218;
const baseURL = `http://127.0.0.1:${port}`;
process.env.NEXTAUTH_URL = baseURL;
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || "final-integration-playwright-test-secret";
const serverEnv = Object.fromEntries(
  Object.entries(
    createSanitizedTestServerEnv({
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      NODE_ENV: "test",
    }),
  ).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  globalSetup: "./tests/playwright/partner-management.setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/health`,
    env: serverEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

void testDatabaseUrl;
