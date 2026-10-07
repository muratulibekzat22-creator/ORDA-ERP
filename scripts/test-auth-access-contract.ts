import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const auth = read("app/api/auth/[...nextauth]/route.ts");
const login = read("app/login/page.tsx");
const proxy = read("proxy.ts");
const migration = read(
  "prisma/migrations/20261007124500_permanent_account_access/migration.sql",
);

assert.match(auth, /credentials:\s*\{\s*email:[\s\S]*password:/u);
assert.doesNotMatch(
  `${auth}\n${login}\n${proxy}`,
  /totp|authenticator|two.?factor|one.?time password|mfa challenge/iu,
  "employee login must not require an MFA challenge",
);
assert.doesNotMatch(
  `${auth}\n${proxy}`,
  /operationalAccessFailure|TEMPORARY_ACCESS_EXPIRED|OPERATIONAL_ACCESS_REVOKED/u,
  "active director access must not expire through a temporary-access gate",
);
assert.match(
  auth,
  /accountRole === "OPERATIONS_DIRECTOR" \? "DIRECTOR" : accountRole/u,
  "operations director must enter the director cabinet while retaining accountRole",
);
assert.match(proxy, /accountRole === "OPERATIONS_DIRECTOR" \? "DIRECTOR" : accountRole/u);
for (const role of ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"]) {
  assert.ok(proxy.includes(role), `${role} page access is missing`);
}
for (const reset of [
  '"failedLoginAttempts" = 0',
  '"lockedUntil" = NULL',
  '"mustChangePassword" = false',
  'WHERE "active" = true',
]) {
  assert.ok(migration.includes(reset), `active account release reset is missing: ${reset}`);
}

console.log("Password-only role access contract passed");
