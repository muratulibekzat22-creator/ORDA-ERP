import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changePercent, paymentEffect, resolveReportRange, safePercent } from "../lib/reports";

const now = new Date("2026-08-08T18:30:00.000Z"); // 23:30 in Almaty
const today = resolveReportRange(new URLSearchParams("period=today"), now);
assert.equal(today.dateFrom, "2026-08-08");
assert.equal(today.start.toISOString(), "2026-08-07T19:00:00.000Z");
assert.equal(today.end.toISOString(), "2026-08-08T18:59:59.999Z");

const week = resolveReportRange(new URLSearchParams("period=week"), now);
assert.equal(week.dateFrom, "2026-08-03");
assert.equal(week.dateTo, "2026-08-08");
const month = resolveReportRange(new URLSearchParams("period=month"), now);
assert.equal(month.dateFrom, "2026-08-01");
assert.equal(month.previousEnd.getTime() + 1, month.start.getTime());
assert.equal(month.end.getTime() - month.start.getTime(), month.previousEnd.getTime() - month.previousStart.getTime());

const custom = resolveReportRange(new URLSearchParams("period=custom&dateFrom=2026-07-10&dateTo=2026-07-12"), now);
assert.equal(custom.start.toISOString(), "2026-07-09T19:00:00.000Z");
assert.throws(() => resolveReportRange(new URLSearchParams("period=custom&dateFrom=2026-08-09&dateTo=2026-08-08"), now));
assert.equal(safePercent(2, 5), 40);
assert.equal(safePercent(2, 0), null);
assert.equal(changePercent(15, 10), 50);
assert.equal(changePercent(10, 0), null);
assert.equal(paymentEffect("CLIENT_PAYMENT", 1_000), 1_000);
assert.equal(paymentEffect("REFUND", 250), -250);
assert.equal(paymentEffect("PARTNER_PAYOUT", 500), 0);

const service = readFileSync(new URL("../lib/services/report.service.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/reports/route.ts", import.meta.url), "utf8");
assert.match(service, /actor\.role === Role\.MANAGER\) scope = \{ managerUserId: actor\.id \}/, "manager scope must ignore spoofed managerId");
assert.match(service, /lifecycle: \{ not: "CANCELLED" \}/, "cancelled orders must be excluded");
assert.match(service, /actor\.role === Role\.DIRECTOR \? \{ grossMargin \} : \{\}/, "gross margin must be director-only");
assert.match(route, /requirePermission\("reports"\)/, "reports API must require permission");
assert.match(route, /report\.sales\.grossMargin === undefined/, "export must redact gross margin");
console.log("Reports math, period boundaries, refunds, zero denominators and RBAC contracts: OK");
