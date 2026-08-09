import assert from "node:assert/strict";

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
console.log("Mutation test production database guard passed");
