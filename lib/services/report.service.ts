import { Role, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { changePercent, money, paymentEffect, resolveReportRange, safePercent, type ReportsReadModel } from "@/lib/reports";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { getCompanyProfitability } from "@/lib/services/profitability.service";

type Actor = { id: number; role: Role };
type Scope = { managerUserId?: number };
const range = (start: Date, end: Date) => ({ gte: start, lte: end });

export async function getReportsReadModel(params: URLSearchParams, actor: Actor): Promise<ReportsReadModel> {
  const companyId = requireTenantIdentity().companyId;
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.OPERATIONS_DIRECTOR && actor.role !== Role.MANAGER && actor.role !== Role.ACCOUNTANT) throw new Error("REPORT_ROLE_FORBIDDEN");
  const period = resolveReportRange(params);
  const requestedManager = params.get("managerId");
  let scope: Scope = {};
  if (actor.role === Role.MANAGER) scope = { managerUserId: actor.id };
  else if (requestedManager) {
    const managerId = Number(requestedManager);
    if (!Number.isInteger(managerId) || managerId <= 0 || !await prisma.user.findFirst({ where: { id: managerId, role: Role.MANAGER, active: true }, select: { id: true } })) throw new Error("INVALID_MANAGER");
    scope = { managerUserId: managerId };
  }
  const orderScope: Prisma.OrderWhereInput = { deletedAt: null, ...(scope.managerUserId ? { managerUserId: scope.managerUserId } : {}) };
  const clientScope: Prisma.ClientWhereInput = { active: true, deletedAt: null, ...(scope.managerUserId ? { managerUserId: scope.managerUserId } : {}) };
  const activeOrder: Prisma.OrderWhereInput = { ...orderScope, lifecycle: { not: "CANCELLED" } };
  const [clients, previousClients, orders, previousOrders, measurements, previousMeasurements, payments, previousPayments, production, managerUsers, completed] = await Promise.all([
    prisma.client.findMany({ where: { ...clientScope, createdAt: range(period.start, period.end) }, select: { id: true, managerUserId: true, stage: true } }),
    prisma.client.findMany({ where: { ...clientScope, createdAt: range(period.previousStart, period.previousEnd) }, select: { id: true } }),
    prisma.order.findMany({ where: { ...activeOrder, createdAt: range(period.start, period.end) }, select: { id: true, number: true, amount: true, partnerId: true, partnerPrice: true, partnerAgreedAt: true, companyProfit: true, manager: true, managerUserId: true, lifecycle: true, status: true, createdAt: true, client: { select: { name: true } }, payments: { select: { amount: true, type: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.order.findMany({ where: { ...activeOrder, createdAt: range(period.previousStart, period.previousEnd) }, select: { amount: true } }),
    prisma.measurement.findMany({ where: { visitDate: range(period.start, period.end), order: activeOrder }, select: { order: { select: { managerUserId: true } } } }),
    prisma.measurement.count({ where: { visitDate: range(period.previousStart, period.previousEnd), order: activeOrder } }),
    prisma.payment.findMany({ where: { operationDate: range(period.start, period.end), order: activeOrder }, select: { amount: true, type: true, operationDate: true, order: { select: { managerUserId: true } } } }),
    prisma.payment.findMany({ where: { operationDate: range(period.previousStart, period.previousEnd), order: activeOrder }, select: { amount: true, type: true } }),
    prisma.production.groupBy({ by: ["stage"], where: { order: { ...orderScope, lifecycle: { not: "CANCELLED" }, createdAt: range(period.start, period.end) } }, _count: { _all: true }, orderBy: { stage: "asc" } }),
    actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR || actor.role === Role.ACCOUNTANT ? prisma.user.findMany({ where: { role: Role.MANAGER, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : prisma.user.findMany({ where: { id: actor.id }, select: { id: true, name: true } }),
    prisma.order.count({ where: { ...orderScope, lifecycle: "COMPLETED", completedAt: range(period.start, period.end) } }),
  ]);
  const internalFinance = actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR || actor.role === Role.ACCOUNTANT;
  const profitability = internalFinance
    ? await getCompanyProfitability({ from: period.start, to: period.end, managerUserId: scope.managerUserId })
    : null;
  type PayrollTotalsRow = { kind: "accrual" | "payment"; total: Prisma.Decimal; period_total: Prisma.Decimal };
  const [customerBalance, partnerBalance, payrollTotals] = await Promise.all([
    prisma.order.aggregate({ where: activeOrder, _sum: { balance: true } }),
    prisma.order.aggregate({ where: { ...activeOrder, partnerId: { not: null }, partnerAgreedAt: { not: null } }, _sum: { partnerBalance: true } }),
    internalFinance ? prisma.$queryRaw<PayrollTotalsRow[]>`
      SELECT 'accrual'::text AS kind,
        COALESCE(SUM(CASE WHEN accrual.direction = 'INCREASE'::"PayrollDirection" THEN accrual.amount ELSE -accrual.amount END), 0) AS total,
        COALESCE(SUM(CASE WHEN accrual."createdAt" >= ${period.start} AND accrual."createdAt" <= ${period.end} THEN CASE WHEN accrual.direction = 'INCREASE'::"PayrollDirection" THEN accrual.amount ELSE -accrual.amount END ELSE 0 END), 0) AS period_total
      FROM "PayrollAccrual" accrual
      JOIN "EmployeePayrollProfile" employee ON employee.id = accrual."employeeId"
      JOIN "User" account ON account.id = employee."userId"
      WHERE employee."companyId" = ${companyId} AND employee.active = true AND employee."payrollEnabled" = true AND account.active = true
      UNION ALL
      SELECT 'payment'::text AS kind,
        COALESCE(SUM(CASE WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType" THEN -payment.amount ELSE payment.amount END), 0) AS total,
        COALESCE(SUM(CASE WHEN payment."paymentDate" >= ${period.start} AND payment."paymentDate" <= ${period.end} THEN CASE WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType" THEN -payment.amount ELSE payment.amount END ELSE 0 END), 0) AS period_total
      FROM "PayrollPayment" payment
      JOIN "EmployeePayrollProfile" employee ON employee.id = payment."employeeId"
      JOIN "User" account ON account.id = employee."userId"
      WHERE employee."companyId" = ${companyId} AND employee.active = true AND employee."payrollEnabled" = true AND account.active = true`
    : Promise.resolve([]),
  ]);
  const received = payments.reduce((sum, item) => sum + paymentEffect(item.type, item.amount), 0);
  const previousReceived = previousPayments.reduce((sum, item) => sum + paymentEffect(item.type, item.amount), 0);
  const salesAmount = orders.reduce((sum, item) => sum + money(item.amount), 0);
  const previousSales = previousOrders.reduce((sum, item) => sum + money(item.amount), 0);
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
  const grossMargin = Number(profitability?.totals.grossMargin ?? 0);
  const currentCustomerRemaining = Math.max(Number(customerBalance._sum.balance ?? 0), 0);
  const currentPartnerRemaining = Math.max(Number(partnerBalance._sum.partnerBalance ?? 0), 0);
  const payrollAccruedRow = payrollTotals.find((row) => row.kind === "accrual");
  const payrollPaidRow = payrollTotals.find((row) => row.kind === "payment");
  const payrollAccruedAll = Number(payrollAccruedRow?.total ?? 0);
  const payrollPaidAll = Number(payrollPaidRow?.total ?? 0);
  const payrollAccrued = Number(payrollAccruedRow?.period_total ?? 0);
  const payrollPaid = Number(payrollPaidRow?.period_total ?? 0);
  const partnerAgreed = orders.filter((item) => item.partnerAgreedAt !== null).reduce((sum, item) => sum + money(item.partnerPrice), 0);
  const partnerPaid = payments.reduce((sum, item) => sum + (item.type === "PARTNER_PAYOUT" ? money(item.amount) : item.type === "PARTNER_PAYOUT_REVERSAL" ? -money(item.amount) : 0), 0);
  return {
    generatedAt: new Date().toISOString(), role: actor.role as ReportsReadModel["role"],
    period: { preset: period.preset, dateFrom: period.dateFrom, dateTo: period.dateTo, timezone: period.timezone, start: period.start.toISOString(), end: period.end.toISOString(), previousStart: period.previousStart.toISOString(), previousEnd: period.previousEnd.toISOString() },
    summary: {
      leads: { current: clients.length, previous: previousClients.length, changePercent: changePercent(clients.length, previousClients.length) },
      measurements: { current: measurements.length, previous: previousMeasurements, changePercent: changePercent(measurements.length, previousMeasurements) },
      orders: { current: orders.length, previous: previousOrders.length, changePercent: changePercent(orders.length, previousOrders.length) },
      salesAmount: { current: salesAmount, previous: previousSales, changePercent: changePercent(salesAmount, previousSales) },
      received: { current: received, previous: previousReceived, changePercent: changePercent(received, previousReceived) }, remaining: currentCustomerRemaining, conversion: safePercent(orders.length, clients.length),
    },
    sales: { count: orders.length, amount: salesAmount, averageOrder: orders.length ? salesAmount / orders.length : 0, completed, cancelled, ...(actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR ? { grossMargin } : {}) },
    payments: { received, remaining: currentCustomerRemaining },
    ...(internalFinance ? { finance: {
      sales: Number(profitability?.totals.sales ?? salesAmount),
      customerReceived: Number(profitability?.totals.clientReceived ?? received),
      customerRemaining: currentCustomerRemaining,
      partnerAgreed,
      partnerPaid: Number(profitability?.totals.partnerPaid ?? partnerPaid),
      partnerRemaining: currentPartnerRemaining,
      grossMargin,
      payrollAccrued,
      payrollPaid,
      payrollPayable: Math.max(payrollAccruedAll - payrollPaidAll, 0),
    } } : {}),
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
