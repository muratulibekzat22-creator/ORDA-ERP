import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectControlIssues, type ControlLead, type ControlOrder } from "../lib/control/rules";
const now = new Date("2026-10-02T04:00:00Z");
const lead: ControlLead = { id: 1, name: "Клиент", managerUserId: 4, createdAt: new Date("2026-09-30T04:00:00Z"), nextContactAt: new Date("2026-10-03T04:00:00Z"), nextActions: [], interactions: [] };
assert.match(detectControlIssues([lead], [], now)[0].reason, /нет записи о контакте/);
assert.equal(detectControlIssues([{ ...lead, interactions: [{ createdAt: now }] }], [], now).length, 0);
assert.equal(detectControlIssues([{ ...lead, nextActions: [{ nextActionAt: now, completedAt: now, resultComment: "Клиент ответил", nextActionType: "CALL" }] }], [], now).length, 0, "Recorded call results count as contact evidence");
assert.match(detectControlIssues([{ ...lead, nextActions: [{ nextActionAt: new Date("2026-09-30") }] }], [], now)[0].reason, /Просрочено/);
const order: ControlOrder = { id: 2, number: "ORDER-2", clientId: 1, responsibleType: "EMPLOYEE", managerUserId: 4, partnerId: null, partnerPrice: 0, partnerAgreedAt: null, promisedAt: new Date("2026-10-03"), productionDeadline: null, lifecycle: "CREATED", client: { phone: "70000000000", city: "Алматы" } };
assert.match(detectControlIssues([], [order], now)[0].reason, /цех.*цена производства/, "every active order must expose the workshop and production-price gaps");
assert.equal(detectControlIssues([], [{ ...order, partnerId: 1, partnerPrice: 9_999, partnerAgreedAt: now }], now)[0].reason.includes("цена производства"), true, "placeholder production prices must not pass control");
assert.equal(detectControlIssues([], [{ ...order, promisedAt: new Date("2026-10-01") }], now).some((issue) => issue.priority === "URGENT"), true);
const companyOrder: ControlOrder = {
  ...order,
  id: 3,
  number: "ORDER-COMPANY",
  responsibleType: "COMPANY",
  managerUserId: 4,
  partnerId: 1,
  partnerPrice: 500_000,
  partnerAgreedAt: now,
};
assert.equal(
  detectControlIssues([], [companyOrder], now).some((issue) =>
    issue.reason.includes("ответственный менеджер"),
  ),
  false,
  "a COMPANY order must not create a missing-manager control issue",
);
const companyIssues = detectControlIssues([], [{
  ...companyOrder,
  client: { phone: "", city: "Алматы" },
}], now);
assert(companyIssues.length > 0, "company fixture must produce a control issue");
assert(
  companyIssues.every((issue) => issue.assigneeId === null),
  "a stale employee id on a COMPANY order must never receive order control work",
);
const founderControlService = readFileSync("lib/services/founder-control.service.ts", "utf8");
assert.match(
  founderControlService,
  /task\.order!\.responsibleType === "EMPLOYEE"[\s\S]*\? task\.order!\.managerUserId[\s\S]*: null/,
  "overdue payment control must resolve its assignee from the current order responsibility",
);
console.log("Founder control evidence and mandatory workshop-price rules passed");
