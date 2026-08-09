import path from "node:path";

import dotenv from "dotenv";

import { assertSafeTestDatabaseUrl, databaseFingerprint, sanitizedTestServerEnv } from "./test-database-safety";

const parsed = dotenv.config({ path: path.join(process.cwd(), ".env.test.local"), quiet: true }).parsed;
export const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL ?? parsed?.TEST_DATABASE_URL);
export const testDatabaseFingerprint = databaseFingerprint(testDatabaseUrl);
process.env.TEST_DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL = testDatabaseUrl;
delete process.env.VERCEL;
process.env.VERCEL_ENV = "";
process.env.VERCEL_OIDC_TOKEN = "";
process.env.VERCEL_TARGET_ENV = "";
process.env.VERCEL_URL = "";

export function createSanitizedTestServerEnv(additions: Record<string, string | undefined> = {}) {
  return sanitizedTestServerEnv(testDatabaseUrl, additions);
}
