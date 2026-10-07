import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assertSafeTestDatabaseUrl } from "./test-database-safety";

assert.throws(() => assertSafeTestDatabaseUrl(undefined), /TEST_DATABASE_URL is required/u);
assert.throws(
  () => assertSafeTestDatabaseUrl("postgresql://test:secret@ep-quiet-brook-ayd2fvc5-pooler.c-5.us-east-2.aws.neon.tech/neondb"),
  /refused production database identity/u,
);
assert.equal(
  assertSafeTestDatabaseUrl("postgresql://test:secret@test-db.example.invalid/orda_test"),
  "postgresql://test:secret@test-db.example.invalid/orda_test",
);

const vercelBuild = readFileSync(new URL("./vercel-build.mjs", import.meta.url), "utf8");
assert.match(
  vercelBuild,
  /VERCEL_ENV === "preview"[\s\S]*RUN_PREVIEW_MARKETING_SMOKE === "true"[\s\S]*TEST_DATABASE_URL = process\.env\.DATABASE_URL[\s\S]*test:marketing/,
  "database mutation smoke tests must be opt-in and preview-only",
);
assert.doesNotMatch(
  vercelBuild,
  /VERCEL_ENV === "production"[\s\S]{0,200}test:marketing/,
  "marketing mutation tests must never run in production builds",
);
console.log("Mutation test production database guard passed");
