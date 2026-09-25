import "./require-test-database";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OrderLifecycle, Role } from "@prisma/client";
import { dashboardPeriodRange, getDashboardSummary } from "../lib/services/dashboard.service";
import { prisma } from "../lib/prisma";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Dashboard integration requires TEST_DATABASE_URL");
const tag = `dashboard-${Date.now()}`;

type ManagementProjection = {
  finance: { revenue: number; received: number; directExpenses: number; netProfit: number; ordersWithMargin: number; ordersWithoutMargin: number };
  orders: { active: number; beforeWorkshop: number; incompleteData: number };
  attention: Array<{ id: number }>;
};
type ManagerProjection = { orders: { active: number; overdue: number; incompleteData: number }; attention: Array<{ missingFields: string[] }> };
type RestrictedProjection = Record<string, unknown>;

async function main() {
  const month = dashboardPeriodRange("month", new Date("2026-08-31T20:30:00.000Z"));
  const today = dashboardPeriodRange("today", new Date("2026-08-31T20:30:00.000Z"));
  assert.equal(month.start.toISOString(), "2026-08-31T19:00:00.000Z");
  assert.equal(today.start.toISOString(), "2026-08-31T19:00:00.000Z");
  const userIds: number[] = [], clientIds: number[] = [], orderIds: number[] = [], paymentIds: number[] = [];
  let partnerId = 0;
  try {
    const baseline = await getDashboardSummary({
      role: Role.DIRECTOR,
      userId: -2147483000,
      period: "month",
    }) as unknown as ManagementProjection;
    const manager = await prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "not-used", role: Role.MANAGER } });
    const other = await prisma.user.create({ data: { name: `${tag}-other`, email: `${tag}-other@test.local`, password: "not-used", role: Role.MANAGER } });
    const inactive = await prisma.user.create({ data: { name: `${tag}-inactive`, email: `${tag}-inactive@test.local`, password: "not-used", role: Role.MANAGER, active: false } });
    userIds.push(manager.id, other.id, inactive.id);
    const ownLead = await prisma.client.create({ data: { name: `${tag}-own`, phone: `+7${Date.now()}`, city: "TEST", manager: manager.name, managerUserId: manager.id, amount: "1000", status: "New" } });
    const otherLead = await prisma.client.create({ data: { name: `${tag}-other`, phone: `+8${Date.now()}`, city: "TEST", manager: other.name, managerUserId: other.id, amount: "2000", status: "New" } });
    clientIds.push(ownLead.id, otherLead.id);
    partnerId = (await prisma.partner.create({ data: { name: tag } })).id;
    const ownOrder = await prisma.order.create({ data: { number: `${tag}-own`, clientId: ownLead.id, manager: manager.name, managerUserId: manager.id, address: "TEST", staircase: "Straight", material: "Oak", amount: "1000", prepayment: "400", balance: "600", partnerId, partnerPrice: "500", partnerAgreedAt: new Date(), partnerPaid: "100", partnerBalance: "400", companyProfit: "500", lifecycle: OrderLifecycle.CREATED, status: "New" } });
    const cancelled = await prisma.order.create({ data: { number: `${tag}-cancelled`, clientId: ownLead.id, manager: manager.name, managerUserId: manager.id, address: "TEST", staircase: "Straight", material: "Oak", amount: "9000", balance: "9000", partnerId, partnerPrice: "5000", partnerBalance: "5000", lifecycle: OrderLifecycle.CANCELLED, status: "Cancelled" } });
    const foreignOrder = await prisma.order.create({ data: { number: `${tag}-foreign`, clientId: otherLead.id, manager: other.name, managerUserId: other.id, address: "TEST", staircase: "Straight", material: "Oak", amount: "2000", balance: "2000", lifecycle: OrderLifecycle.CREATED, status: "New" } });
    orderIds.push(ownOrder.id, cancelled.id, foreignOrder.id);
    paymentIds.push((await prisma.payment.create({ data: { orderId: ownOrder.id, amount: "400", type: "CLIENT_PAYMENT", method: "TEST", author: manager.name } })).id);

    const [director, scopedManager, emptyManager, accountant, production, installer] = await Promise.all([
      getDashboardSummary({ role: Role.DIRECTOR, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.MANAGER, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.MANAGER, userId: -2147483000, period: "month" }),
      getDashboardSummary({ role: Role.ACCOUNTANT, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.PRODUCTION, userId: manager.id, period: "month" }),
      getDashboardSummary({ role: Role.INSTALLER, userId: manager.id, period: "month" }),
    ]) as unknown as [
      ManagementProjection,
      ManagerProjection,
      ManagerProjection,
      ManagementProjection,
      RestrictedProjection,
      RestrictedProjection,
    ];
    assert.equal(director.finance.revenue - baseline.finance.revenue, 3000, "director revenue must use current non-cancelled orders");
    assert.equal(director.finance.received - baseline.finance.received, 400, "client receipts must use Payment rows");
    assert.equal(director.finance.directExpenses - baseline.finance.directExpenses, 500, "agreed partner cost must enter direct expenses once");
    assert.equal(director.finance.netProfit - baseline.finance.netProfit, 500, "complete orders must keep contributing profit");
    assert.equal(director.finance.ordersWithMargin - baseline.finance.ordersWithMargin, 1, "priced order counter is wrong");
    assert.equal(director.finance.ordersWithoutMargin - baseline.finance.ordersWithoutMargin, 1, "incomplete order must be reported separately");
    assert.equal(director.orders.active - baseline.orders.active, 2, "cancelled order entered active order counters");
    assert.equal(director.orders.beforeWorkshop - baseline.orders.beforeWorkshop, 2);
    assert.equal(director.orders.incompleteData - baseline.orders.incompleteData, 2, "incomplete order counter is wrong");
    assert(director.attention.some((row: { id: number }) => row.id === foreignOrder.id), "incomplete order is missing from attention");
    assert.equal(scopedManager.orders.active, 1, "manager received another manager's order");
    assert.equal(scopedManager.orders.overdue, 0);
    assert.equal(scopedManager.orders.incompleteData, 1);
    assert(scopedManager.attention[0]?.missingFields.includes("Срок заказа"), "manager did not receive the exact missing field");
    assert.equal(emptyManager.orders.active, 0);
    assert("finance" in accountant, "accountant finance projection is missing");
    assert(!("finance" in production), "production received finance projection");
    assert(!("finance" in installer), "installer received finance projection");

    const route = readFileSync("app/api/dashboard/sales/route.ts", "utf8");
    assert(!route.includes("searchParams.get(\"role\")"), "dashboard accepts a role override");
    assert(route.includes("!session?.user") && route.includes("status: 401"), "unauthenticated dashboard access is not rejected");
    assert(route.includes("const role = session.user.role as Role"), "dashboard role is not derived from the authenticated session");
    const dashboard = readFileSync("components/dashboard/DirectorCockpit.tsx", "utf8");
    for (const label of ["Выручка", "Получено от клиентов", "Цена производства", "Прочие доходы", "Операционные расходы", "Начисленная зарплата", "Выплаченная зарплата", "Чистая прибыль", "Чистая маржа", "Добавить доход", "Добавить расход", "Требуют внимания", "Нужно дополнить", "Что нужно дополнить по заказам"]) assert.ok(dashboard.includes(label), `dashboard label missing: ${label}`);
    assert(!dashboard.includes("<table"), "Director team performance must not regress to a wide table");
    for (const routeName of ["/orders?tab=active", "/orders?tab=active&attention=overdue"]) assert.ok(dashboard.includes(routeName), `dashboard route missing: ${routeName}`);
    for (const removed of ["/clients", "/calendar", "/warehouse", "/production", "/measurements"])
      assert(!dashboard.includes(`href=\"${removed}`), `legacy Director shortcut remains: ${removed}`);
    const home = readFileSync("app/page.tsx", "utf8");
    assert(home.includes("getServerSession"), "home role projection is not server-side");
    console.log("dashboard role projections, own scope, cancelled exclusion, balances, empty state and routes passed");
  } finally {
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (partnerId) await prisma.partner.deleteMany({ where: { id: partnerId } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

void main().finally(() => prisma.$disconnect());
