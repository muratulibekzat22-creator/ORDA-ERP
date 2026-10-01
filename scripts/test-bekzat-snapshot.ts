import assert from "node:assert/strict";
import { toBekzatSnapshot } from "@/lib/control/bekzat-snapshot";
const pii = "PRIVATE_CLIENT_NAME_PHONE_ADDRESS";
const input = {
  checkedAt: new Date().toISOString(),
  summary: { overdue: 1, verified: 0, unacknowledged: 1 },
  users: [{ name: pii }], tasks: [{ resultText: pii }],
  issues: [{ key: "lead:42", clientId: 42, assigneeId: 7,
    title: pii, reason: pii, action: pii, href: `/clients/42?name=${pii}`, assignee: pii,
    task: { status: "PLANNED", dueAt: new Date(), acknowledgedAt: null, resultSubmittedAt: null, description: pii } }],
} as unknown as Parameters<typeof toBekzatSnapshot>[0];
const result = toBekzatSnapshot(input);
assert.equal(JSON.stringify(result).includes(pii), false);
assert.equal("users" in result, false);
assert.equal("tasks" in result, false);
assert.equal(result.issues[0].href, "/clients/42");
assert.deepEqual(Object.keys(result.issues[0].task!).sort(), ["acknowledgedAt", "dueAt", "resultSubmittedAt", "status"]);
console.log("BEKZAT snapshot excludes PII, free text, users and raw task records");
