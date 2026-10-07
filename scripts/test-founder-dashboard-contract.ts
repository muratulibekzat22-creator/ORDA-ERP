import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitDashboardReceipts } from "../lib/finance/dashboard-receipts";

async function main() {
  // Importing the service creates a Prisma client, but this check never connects to a database.
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
  const { dashboardMonthRange } = await import("../lib/services/dashboard.service");
  const september = dashboardMonthRange("2026-09");
  const october = dashboardMonthRange("2026-10");
  assert.equal(september.end.toISOString(), "2026-09-30T19:00:00.000Z");
  assert.equal(october.start.toISOString(), september.end.toISOString(), "September expenses must end before October begins");
  assert.equal(october.end.toISOString(), "2026-10-31T19:00:00.000Z");
  assert(new Date("2026-09-30T18:59:59.999Z") < october.start);
  assert(new Date("2026-09-30T19:00:00.000Z") >= october.start);

  const payments = [
    { orderId: 10, type: "CLIENT_PAYMENT", amount: 4_000_000 },
    { orderId: 9, type: "CLIENT_PAYMENT", amount: 7_000_000 },
  ];
  const split = splitDashboardReceipts(payments, new Set([10]));
  assert.equal(split.received, 11_000_000);
  assert.equal(split.receivedForPeriodOrders, 4_000_000);
  assert.equal(split.receivedFromOtherOrders, 7_000_000);
  assert.deepEqual(split.classified.map((row) => row.fromPeriodOrder), [true, false]);

  const refunded = splitDashboardReceipts([...payments, { orderId: 9, type: "REFUND", amount: 500_000 }], new Set([10]));
  assert.equal(refunded.received, 10_500_000);
  assert.equal(refunded.receivedFromOtherOrders, 6_500_000);
  const dashboardService = readFileSync("lib/services/dashboard.service.ts", "utf8");
  const dashboardPage = readFileSync("components/dashboard/DirectorCockpit.tsx", "utf8");
  assert.match(dashboardService, /prisma\.payment\.findMany\(\{[\s\S]*?where: \{[\s\S]*?companyId,[\s\S]*?deletedAt: null,[\s\S]*?operationDate:/, "dashboard cash must be tenant-scoped and ignore soft-deleted payment rows");
  assert.doesNotMatch(dashboardService, /operationDate: \{ gte: period\.start, lt: period\.end \}[\s\S]{0,350}order: \{[\s\S]{0,120}lifecycle: \{ not: OrderLifecycle\.CANCELLED \}/, "later order cancellation must not erase a historical receipt");
  assert.match(dashboardService, /receivedForWeekOrders: weeklyReceipts\.receivedForPeriodOrders/);
  assert.match(dashboardService, /receivedFromPriorOrders: weeklyReceipts\.receivedFromOtherOrders/);
  assert.match(dashboardPage, /Заказы за неделю/);
  assert.match(dashboardPage, /по ранее оформленным/);
  assert.doesNotMatch(dashboardPage.slice(dashboardPage.indexOf("Недельный отчёт собственника"), dashboardPage.indexOf("Главная картина бизнеса")), /Цена производства заполнена/);
  console.log("Founder month boundaries and mixed-month customer receipts passed");
}

void main();
