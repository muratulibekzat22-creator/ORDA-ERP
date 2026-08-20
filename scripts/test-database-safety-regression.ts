import assert from "node:assert/strict";

import { assertSafeTestDatabaseUrl } from "./test-database-safety";
import { assertFinalPreviewEnvironment, databaseFingerprint } from "./preview-database-safety";

assert.throws(() => assertSafeTestDatabaseUrl(undefined), /TEST_DATABASE_URL is required/u);
assert.throws(
  () => assertSafeTestDatabaseUrl("postgresql://test:secret@ep-quiet-brook-ayd2fvc5-pooler.c-5.us-east-2.aws.neon.tech/neondb"),
  /refused production database identity/u,
);
assert.equal(
  assertSafeTestDatabaseUrl("postgresql://test:secret@test-db.example.invalid/orda_test"),
  "postgresql://test:secret@test-db.example.invalid/orda_test",
);
const previewUrl = "postgresql://preview:secret@preview-db.example.invalid/orda_erp_final_preview";
const directUrl = "postgresql://preview:secret@preview-db.example.invalid/orda_erp_final_preview?connection_limit=1";
const productionUrl = "postgresql://production:secret@production-db.example.invalid/orda";
const safePreviewEnvironment = {
  DATABASE_URL: previewUrl,
  DIRECT_URL: directUrl,
  PREVIEW_DATABASE_CONFIRMED: "true",
  DEMO_MODE_ENABLED: "true",
  DEMO_TENANT_SLUG: "altyn-sapa-demo",
  PREVIEW_DATABASE_FINGERPRINT: databaseFingerprint(previewUrl),
  PRODUCTION_DATABASE_FINGERPRINT: databaseFingerprint(productionUrl),
};
assert.equal(assertFinalPreviewEnvironment(safePreviewEnvironment).database, "orda_erp_final_preview");
assert.throws(
  () => assertFinalPreviewEnvironment({ ...safePreviewEnvironment, DATABASE_URL: productionUrl, PREVIEW_DATABASE_FINGERPRINT: databaseFingerprint(productionUrl), PRODUCTION_DATABASE_FINGERPRINT: databaseFingerprint(productionUrl) }),
  /dedicated orda_erp_final_preview|not proven different/u,
);
assert.throws(
  () => assertFinalPreviewEnvironment({ ...safePreviewEnvironment, PREVIEW_DATABASE_CONFIRMED: "false" }),
  /refused outside a confirmed Preview environment/u,
);
console.log("Mutation test production database guard passed");
