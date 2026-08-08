import { Role, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { changePercent, money, paymentEffect, resolveReportRange, safePercent, type ReportsReadModel } from "@/lib/reports";

type Actor = { id: number; role: Role };
type Scope = { managerUserId?: number };
const range = (start: Date, end: Date) => ({ gte: start, lte: end });

export async function getReportsReadModel(params: URLSearchParams, actor: Actor): Promise<ReportsReadModel> {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER && actor.role !== Role.ACCOUNTANT) throw new Error("REPORT_ROLE_FORBIDDEN");
  const period = resolveReportRange(params);
  const requestedManager = params.get("managerId");
  let scope: Scope = {};
  if (actor.role === Role.MANAGER) scope = { managerUserId: actor.id };
  else if (requestedManager) {
    const managerId = Number(requestedManager);
    if (!Number.isInteger(managerId) || managerId <= 0 || !await prisma.user.findFirst({ where: { id: managerId, role: Role.MANAGER, active: true }, select: { id: true } })) throw new Error("INVALID_MANAGER");
    scope = { managerUserId: managerId };
  }
  const orderScope: Prisma.OrderWhereInput = scope.managerUserId ? { managerUserId: scope.managerUserId } : {};
  const clientScope: Prisma.ClientWhereInput = scope.managerUserId ? { managerUserId: scope.managerUserId } : {};
  const activeOrder: Prisma.OrderWhereInput = { ...orderScope, lifecycle: { not: "CANCELLED" } };
  const [clients, previousClients, orders, previousOrders, measurements, previousMeasurements, payments, previousPayments, production, managerUsers, completed] = await Promise.all([
    prisma.client.findMany({ where: { ...clientScope, createdAt: range(period.start, period.end) }, select: { id: true, managerUserId: true, stage: true } }),
    prisma.client.findMany({ where: { ...clientScope, createdAt: range(period.previousStart, period.previousEnd) }, select: { id: true } }),
    prisma.order.findMany({ where: { ...activeOrder, createdAt: range(period.start, period.end) }, select: { id: true, number: true, amount: true, companyProfit: true, manager: true, managerUserId: true, lifecycle: true, status: true, createdAt: true, client: { select: { name: true } }, payments: { select: { amount: true, type: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.order.findMany({ where: { ...activeOrder, createdAt: range(period.previousStart, period.previousEnd) }, select: { amount: true } }),
    prisma.measurement.findMany({ where: { visitDate: range(period.start, period.end), order: activeOrder }, select: { order: { select: { managerUserId: true } } } }),
    prisma.measurement.count({ where: { visitDate: range(period.previousStart, period.previousEnd), order: activeOrder } }),
    prisma.payment.findMany({ where: { operationDate: range(period.start, period.end), order: activeOrder }, select: { amount: true, type: true, operationDate: true, order: { select: { managerUserId: true } } } }),
    prisma.payment.findMany({ where: { operationDate: range(period.previousStart, period.previousEnd), order: activeOrder }, select: { amount: true, type: true } }),
    prisma.production.groupBy({ by: ["stage"], where: { order: { ...orderScope, lifecycle: { not: "CANCELLED" }, createdAt: range(period.start, period.end) } }, _count: { _all: true }, orderBy: { stage: "asc" } }),
    actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT ? prisma.user.findMany({ where: { role: Role.MANAGER, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : prisma.user.findMany({ where: { id: actor.id }, select: { id: true, name: true } }),
    prisma.order.count({ where: { ...orderScope, lifecycle: "COMPLETED", completedAt: range(period.start, period.end) } }),
  ]);
  const received = payments.reduce((sum, item) => sum + paymentEffect(item.type, item.amount), 0);
  const previousReceived = previousPayments.reduce((sum, item) => sum + paymentEffect(item.type, item.amount), 0);
  const salesAmount = orders.reduce((sum, item) => sum + money(item.amount), 0);
  const previousSales = previousOrders.reduce((sum, item) => sum + money(item.amount), 0);
  const remaining = orders.reduce((sum, item) => sum + Math.max(0, money(item.amount) - item.payments.reduce((paid, payment) => paid + paymentEffect(payment.type, payment.amount), 0)), 0);
  const cancelled = await prisma.order.count({ where: { ...orderScope, lifecycle: "CANCELLED", createdAt: range(period.start, period.end) } });
  const managerMap = new Map(managerUsers.map((user) => [user.id, { id: user.id, name: user.name, leads: 0, measurements: 0, orders: 0, salesAmount: 0, received: 0, conversion: null as number | null }]));
  clients.forEach((item) => { if (item.managerUserId && managerMap.has(item.managerUserId)) managerMap.get(item.managerUserId)!.leads += 1; });
  measurements.forEach((item) => { const id = item.order?.managerUserId; if (id && managerMap.has(id)) managerMap.get(id)!.measurements += 1; });
  orders.forEach((item) => { if (item.managerUserId && managerMap.has(item.managerUserId)) { const row = managerMap.get(item.managerUserId)!; row.orders += 1; row.salesAmount += money(item.amount); } });
  payments.forEach((item) => { const id = item.order?.managerUserId; if (id && managerMap.has(id)) managerMap.get(id)!.received += paymentEffect(item.type, item.amount); });
  const managers = [...managerMap.values()].map((item) => ({ ...item, conversion: safePercent(item.orders, item.leads) })).sort((a, b) => b.salesAmount - a.salesAmount);
  const trendMap = new Map<string, { date: string; salesAmount: number; received: number }>();
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: period.timezone }).format(date);
  orders.forEach((item) => { const key = day(item.createdAt); const value = trendMap.get(key) ?? { date: key, salesAmount: 0, received: 0 }; value.salesAmount += money(item.amount); trendMap.set(key, value); });
  payments.forEach((item) => { const key = day(item.operationDate); const value = trendMap.get(key) ?? { date: key, salesAmount: 0, received: 0 }; value.received += paymentEffect(item.type, item.amount); trendMap.set(key, value); });
  const grossMargin = orders.reduce((sum, item) => sum + money(item.companyProfit), 0);
  return {
    generatedAt: new Date().toISOString(), role: actor.role as ReportsReadModel["role"],
    period: { preset: period.preset, dateFrom: period.dateFrom, dateTo: period.dateTo, timezone: period.timezone, start: period.start.toISOString(), end: period.end.toISOString(), previousStart: period.previousStart.toISOString(), previousEnd: period.previousEnd.toISOString() },
    summary: {
      leads: { current: clients.length, previous: previousClients.length, changePercent: changePercent(clients.length, previousClients.length) },
      measurements: { current: measurements.length, previous: previousMeasurements, changePercent: changePercent(measurements.length, previousMeasurements) },
      orders: { current: orders.length, previous: previousOrders.length, changePercent: changePercent(orders.length, previousOrders.length) },
      salesAmount: { current: salesAmount, previous: previousSales, changePercent: changePercent(salesAmount, previousSales) },
      received: { current: received, previous: previousReceived, changePercent: changePercent(received, previousReceived) }, remaining, conversion: safePercent(orders.length, clients.length),
    },
    sales: { count: orders.length, amount: salesAmount, averageOrder: orders.length ? salesAmount / orders.length : 0, completed, cancelled, ...(actor.role === Role.DIRECTOR ? { grossMargin } : {}) },
    payments: { received, remaining },
    funnel: [
      { key: "leads", label: "Заявки", value: clients.length, conversionFromPrevious: null },
      { key: "measurements", label: "Замеры", value: measurements.length, conversionFromPrevious: safePercent(measurements.length, clients.length) },
      { key: "orders", label: "Заказы", value: orders.length, conversionFromPrevious: safePercent(orders.length, measurements.length) },
    ], managers,
    trend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    production: production.map((item) => ({ stage: item.stage, count: item._count._all })),
    orders: orders.slice(0, 20).map((item) => { const paid = item.payments.reduce((sum, payment) => sum + paymentEffect(payment.type, payment.amount), 0); return { id: item.id, number: item.number, client: item.client.name, manager: item.manager, amount: money(item.amount), received: paid, remaining: Math.max(0, money(item.amount) - paid), status: item.status }; }),
  };
}
