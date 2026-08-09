import assert from "node:assert/strict";

import { ACCOUNT_FAILURE_LIMIT, AUTH_WINDOW_MS, accountFailureWindowStart, normalizeAccountIdentifier } from "@/lib/auth-security";

const now = Date.parse("2026-08-09T07:00:00.000Z");
const resetAt = new Date(now - 60_000);
assert.equal(accountFailureWindowStart(resetAt, now).getTime(), resetAt.getTime());
assert.equal(accountFailureWindowStart(new Date(now - AUTH_WINDOW_MS * 2), now).getTime(), now - AUTH_WINDOW_MS);
assert.equal(normalizeAccountIdentifier("  GULSIM@ALTYNSAPA.KZ "), "gulsim@altynsapa.kz");
assert.equal(ACCOUNT_FAILURE_LIMIT, 5);
console.log("auth reset failure-window and identifier normalization checks passed");
