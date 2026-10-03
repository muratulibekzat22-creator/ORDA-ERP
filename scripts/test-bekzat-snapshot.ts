import assert from "node:assert/strict";
import { toBekzatFinance, toBekzatSnapshot } from "@/lib/control/bekzat-snapshot";
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
for (const netProfit of [12345, 0, -1200]) {
  const incomplete = toBekzatFinance({ netProfit, dataComplete: false });
  assert.deepEqual(incomplete, { finance: null, financeStatus: "incomplete" });
  assert.equal(JSON.stringify(incomplete).includes('"netProfit"'), false);
  assert.deepEqual(toBekzatFinance({ netProfit, dataComplete: true }), {
    finance: { netProfit, dataComplete: true }, financeStatus: "complete",
  });
}
assert.deepEqual(toBekzatFinance(null), { finance: null, financeStatus: "unavailable" });
for (const netProfit of [NaN, Infinity, -Infinity]) {
  assert.equal(toBekzatFinance({ netProfit, dataComplete: true }).finance, null);
}
console.log("BEKZAT finance omits incomplete profit, preserves complete zero/negative profit and rejects non-finite values");
