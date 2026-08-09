import "./require-test-database";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OrderLifecycle, Role } from "@prisma/client";
import { dashboardPeriodRange, getDashboardSummary } from "../lib/services/dashboard.service";
import { prisma } from "../lib/prisma";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Dashboard integration requires TEST_DATABASE_URL");
const tag = `dashboard-${Date.now()}`;

async function main() {
  const month = dashboardPeriodRange("month", new Date("2026-08-31T20:30:00.000Z"));
  const today = dashboardPeriodRange("today", new Date("2026-08-31T20:30:00.000Z"));
  assert.equal(month.start.toISOString(), "2026-08-31T19:00:00.000Z");
  assert.equal(today.start.toISOString(), "2026-08-31T19:00:00.000Z");
  const userIds: number[] = [], clientIds: number[] = [], orderIds: number[] = [];
  let partnerId = 0;
  try {
    const manager = await prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "not-used", role: Role.MANAGER } });
    const other = await prisma.user.create({ data: { name: `${tag}-other`, email: `${tag}-other@test.local`, password: "not-used", role: Role.MANAGER } });
    userIds.push(manager.id, other.id);
    const ownLead = await prisma.client.create({ data: { name: `${tag}-own`, phone: `+7${Date.now()}`, city: "TEST", manager: manager.name, managerUserId: manager.id, amount: "1000", status: "New" } });
    const otherLead = await prisma.client.create({ data: { name: `${tag}-other`, phone: `+8${Date.now()}`, city: "TEST", manager: other.name, managerUserId: other.id, amount: "2000", status: "New" } });
    clientIds.push(ownLead.id, otherLead.id);
    partnerId = (await prisma.partner.create({ data: { name: tag } })).id;
    const ownOrder = await prisma.order.create({ data: { number: `${tag}-own`, clientId: ownLead.id, manager: manager.name, managerUserId: manager.id, address: "TEST", staircase: "Straight", material: "Oak", amount: "1000", prepayment: "400", balance: "600", partnerId, partnerPrice: "500", partnerAgreedAt: new Date(), partnerPaid: "100", partnerBalance: "400", companyProfit: "500", lifecycle: OrderLifecycle.CREATED, status: "New" } });
    const cancelled = await prisma.order.create({ data: { number: `${tag}-cancelled`, clientId: ownLead.id, manager: manager.name, managerUserId: manager.id, address: "TEST", staircase: "Straight", material: "Oak", amount: "9000", balance: "9000", partnerId, partnerPrice: "5000", partnerBalance: "5000", lifecycle: OrderLifecycle.CANCELLED, status: "Cancelled" } });
    const foreignOrder = await prisma.order.create({ data: { number: `${tag}-foreign`, clientId: otherLead.id, manager: other.name, managerUserId: other.id, address: "TEST", staircase: "Straight", material: "Oak", amount: "2000", balance: "2000", lifecycle: OrderLifecycle.CREATED, status: "New" } });
    orderIds.push(ownOrder.id, cancelled.id, foreignOrder.id);

    const [director, scopedManager, emptyManager, accountant, production, installer] = await Promise.all([
      getDashboardSummary({ role: Role.DIRECTOR, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.MANAGER, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.MANAGER, userId: -2147483000, period: "month" }),
      getDashboardSummary({ role: Role.ACCOUNTANT, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.PRODUCTION, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.INSTALLER, userId: manager.id, period: "month" }),
    ]);
    const scopedMetrics = scopedManager.metrics as Record<string, number | undefined>;
    const emptyMetrics = emptyManager.metrics as Record<string, number | undefined>;
    assert("managers" in director && "partnerBalancePayable" in director.metrics, "director projection is incomplete");
    assert.equal(director.metrics.partnerBalancePayable, 400, "director partner payable is not based on the agreed partner price");
    assert.equal(scopedMetrics.newLeads, 1, "manager received another manager's leads");
    assert.equal(scopedMetrics.orders, 1, "cancelled or foreign order entered manager sales");
    assert.equal(scopedMetrics.totalSales, 1000, "manager sales are not based on real non-cancelled orders");
    assert.equal(scopedMetrics.balanceToReceive, 600, "manager client remaining is incorrect");
    assert.equal(scopedMetrics.partnerBalancePayable, undefined, "manager received partner settlement");
    assert.equal(emptyMetrics.newLeads, 0); assert.equal(emptyMetrics.orders, 0); assert.equal(emptyMetrics.totalSales, 0);
    assert(!("newLeads" in accountant.metrics), "accountant received CRM projection");
    assert("partnerPayable" in accountant.metrics, "accountant partner payable is missing");
    assert(!("totalSales" in production.metrics), "production received finance projection");
    assert(!("totalSales" in installer.metrics), "installer received finance projection");

    const route = readFileSync("app/api/dashboard/sales/route.ts", "utf8");
    assert(!route.includes("searchParams.get(\"role\")"), "dashboard accepts a role override");
    assert(route.includes("if (!session?.user)") && route.includes("status: 401"), "unauthenticated dashboard access is not rejected");
    assert(route.includes("const role = session.user.role as Role"), "dashboard role is not derived from the authenticated session");
    const dashboard = readFileSync("components/dashboard/DirectorCockpit.tsx", "utf8");
    for (const label of ["Продажи", "Получено", "К получению от клиентов", "К выплате партнёрам", "К выплате сотрудникам", "Мои новые заявки", "Payroll к выплате", "На заготовке", "Следующая установка"]) assert.ok(dashboard.includes(label), `dashboard label missing: ${label}`);
    for (const routeName of ["/clients", "/orders", "/calendar", "/warehouse", "/finance", "/payroll", "/production", "/partners", "/measurements"]) assert.ok(dashboard.includes(routeName), `dashboard route missing: ${routeName}`);
    const home = readFileSync("app/page.tsx", "utf8");
    assert(home.includes("getServerSession"), "home role projection is not server-side");
    console.log("dashboard role projections, own scope, cancelled exclusion, balances, empty state and routes passed");
  } finally {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (partnerId) await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

void main().finally(() => prisma.$disconnect());
