import { OrderResponsibleType, Role, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { changePercent, money, paymentEffect, resolveReportRange, safePercent, type ReportsReadModel } from "@/lib/reports";
import { orderDataGaps } from "@/lib/orders/completeness";
import { hasProductionPrice, MIN_PRODUCTION_PRICE } from "@/lib/orders/production-price";
import { projectOrderStatus, USER_ORDER_STATUS_LABELS } from "@/lib/orders/presentation";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { isOperatingProfitExpense, isAdditionalProfitIncome } from "@/lib/finance/profit-entry";
import { loadOwnershipChanges, ownerAt } from "@/lib/services/handover-attribution";
import {
  approvedPayrollAccountingTotals,
  latestApprovedPayrollSnapshots,
  signedConfirmedPayrollPayment,
} from "@/lib/services/payroll-accounting-read";

type Actor = { id: number; role: Role };
type Scope = { managerUserId?: number; managerName?: string };
const range = (start: Date, end: Date) => ({ gte: start, lte: end });
const leadership = (role: Role) =>
  role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR;

export async function getReportsReadModel(params: URLSearchParams, actor: Actor): Promise<ReportsReadModel> {
  const companyId = requireTenantIdentity().companyId;
  if (!leadership(actor.role) && actor.role !== Role.MANAGER && actor.role !== Role.ACCOUNTANT) throw new Error("REPORT_ROLE_FORBIDDEN");
  const period = resolveReportRange(params);
  const requestedManager = params.get("managerId");
  let scope: Scope = {};
  if (actor.role === Role.MANAGER) {
    const user = await prisma.user.findFirst({ where: { id: actor.id, role: Role.MANAGER }, select: { name: true, payrollProfile: { select: { position: true } } } });
    if (!user || /замер/i.test(user.payrollProfile?.position ?? "")) throw new Error("REPORT_ROLE_FORBIDDEN");
    scope = { managerUserId: actor.id, managerName: user.name };
  }
  else if (requestedManager) {
    const managerId = Number(requestedManager);
    const manager = Number.isInteger(managerId) && managerId > 0 ? await prisma.user.findFirst({ where: { id: managerId, role: Role.MANAGER, NOT: { payrollProfile: { is: { position: { contains: "замер", mode: "insensitive" } } } } }, select: { id: true, name: true } }) : null;
    if (!manager) throw new Error("INVALID_MANAGER");
    scope = { managerUserId: managerId, managerName: manager.name };
  }
  const historicalIds = scope.managerUserId ? await prisma.employeeHandoverItem.findMany({ where: { kind: { in: ["clients", "orders"] }, handover: { companyId, status: "COMPLETED", OR: [{ fromUserId: scope.managerUserId }, { toUserId: scope.managerUserId }] } }, select: { kind: true, entityId: true } }) : [];
  const historicalClientIds = historicalIds.filter((item) => item.kind === "clients").map((item) => item.entityId);
  const historicalOrderIds = historicalIds.filter((item) => item.kind === "orders").map((item) => item.entityId);
  const currentOrderScope: Prisma.OrderWhereInput = { deletedAt: null, ...(scope.managerUserId ? { OR: [{ responsibleType: OrderResponsibleType.EMPLOYEE, managerUserId: scope.managerUserId }, { responsibleType: OrderResponsibleType.EMPLOYEE, managerUserId: null, manager: { equals: scope.managerName, mode: "insensitive" } }] } : {}) };
  const orderScope: Prisma.OrderWhereInput = { deletedAt: null, ...(scope.managerUserId ? { OR: [{ responsibleType: OrderResponsibleType.EMPLOYEE, managerUserId: scope.managerUserId }, { responsibleType: OrderResponsibleType.EMPLOYEE, managerUserId: null, manager: { equals: scope.managerName, mode: "insensitive" } }, { id: { in: historicalOrderIds } }] } : {}) };
  const clientScope: Prisma.ClientWhereInput = { active: true, deletedAt: null, ...(scope.managerUserId ? { OR: [{ managerUserId: scope.managerUserId }, { id: { in: historicalClientIds } }] } : {}) };
  const activeOrder: Prisma.OrderWhereInput = { ...orderScope, lifecycle: { not: "CANCELLED" } };
  // Some period arrays are narrowed to the responsible manager after loading handover history.
  // eslint-disable-next-line prefer-const
  let [clients, previousClients, orders, previousOrders, measurements, previousMeasurementRows, payments, previousPayments, production, managerUsers, completed] = await Promise.all([
    prisma.client.findMany({ where: { ...clientScope, createdAt: range(period.start, period.end) }, select: { id: true, managerUserId: true, stage: true, createdAt: true } }),
    prisma.client.findMany({ where: { ...clientScope, createdAt: range(period.previousStart, period.previousEnd) }, select: { id: true, managerUserId: true, createdAt: true } }),
    prisma.order.findMany({ where: { ...activeOrder, orderDateNeedsReview: false, orderReceivedAt: range(period.start, period.end) }, select: { id: true, number: true, amount: true, partnerId: true, partnerPrice: true, partnerAgreedAt: true, companyProfit: true, manager: true, responsibleType: true, managerUserId: true, lifecycle: true, status: true, orderReceivedAt: true, orderDateNeedsReview: true, promisedAt: true, productionDeadline: true, installation: { select: { scheduledAt: true } }, client: { select: { name: true, phone: true, city: true } }, payments: { select: { amount: true, type: true } } }, orderBy: { orderReceivedAt: "desc" } }),
    prisma.order.findMany({ where: { ...activeOrder, orderDateNeedsReview: false, orderReceivedAt: range(period.previousStart, period.previousEnd) }, select: { id: true, amount: true, managerUserId: true, manager: true, responsibleType: true, orderReceivedAt: true } }),
    prisma.measurement.findMany({ where: { companyId, deletedAt: null, visitDate: range(period.start, period.end), client: { active: true, deletedAt: null } }, select: { clientId: true, visitDate: true, client: { select: { managerUserId: true } }, order: { select: { id: true, managerUserId: true, manager: true, responsibleType: true } } } }),
    prisma.measurement.findMany({ where: { companyId, deletedAt: null, visitDate: range(period.previousStart, period.previousEnd), client: { active: true, deletedAt: null } }, select: { clientId: true, visitDate: true, client: { select: { managerUserId: true } }, order: { select: { id: true, managerUserId: true, manager: true, responsibleType: true } } } }),
    prisma.payment.findMany({ where: { operationDate: range(period.start, period.end), order: activeOrder }, select: { amount: true, type: true, operationDate: true, order: { select: { id: true, managerUserId: true, manager: true, responsibleType: true } } } }),
    prisma.payment.findMany({ where: { operationDate: range(period.previousStart, period.previousEnd), order: activeOrder }, select: { amount: true, type: true, operationDate: true, order: { select: { id: true, managerUserId: true, manager: true, responsibleType: true } } } }),
    prisma.production.groupBy({ by: ["stage"], where: { order: { ...orderScope, lifecycle: { not: "CANCELLED" }, orderDateNeedsReview: false, orderReceivedAt: range(period.start, period.end) } }, _count: { _all: true }, orderBy: { stage: "asc" } }),
    leadership(actor.role) || actor.role === Role.ACCOUNTANT ? prisma.user.findMany({ where: { role: Role.MANAGER, NOT: { payrollProfile: { is: { position: { contains: "замер", mode: "insensitive" } } } } }, select: { id: true, name: true, active: true, payrollProfile: { select: { hiredAt: true, terminatedAt: true } } }, orderBy: { name: "asc" } }) : prisma.user.findMany({ where: { id: actor.id }, select: { id: true, name: true, active: true, payrollProfile: { select: { hiredAt: true, terminatedAt: true } } } }),
    prisma.order.findMany({ where: { ...orderScope, lifecycle: "COMPLETED", completedAt: range(period.start, period.end) }, select: { id: true, managerUserId: true, manager: true, responsibleType: true, completedAt: true } }),
  ]);
  const [leadOwnership, orderOwnership] = await Promise.all([
    loadOwnershipChanges(companyId, "clients", [...new Set([...clients.map((item) => item.id), ...previousClients.map((item) => item.id), ...measurements.map((item) => item.clientId), ...previousMeasurementRows.map((item) => item.clientId)])]),
    loadOwnershipChanges(companyId, "orders", [...new Set([...orders.map((item) => item.id), ...previousOrders.map((item) => item.id), ...completed.map((item) => item.id), ...payments.flatMap((item) => item.order ? [item.order.id] : []), ...previousPayments.flatMap((item) => item.order ? [item.order.id] : []), ...measurements.flatMap((item) => item.order ? [item.order.id] : []), ...previousMeasurementRows.flatMap((item) => item.order ? [item.order.id] : [])])]),
  ]);
  const historicalOwner = (order: { id: number; managerUserId: number | null; manager: string; responsibleType: OrderResponsibleType }, happenedAt: Date) => order.responsibleType === OrderResponsibleType.COMPANY ? null : ownerAt(order.managerUserId ?? (scope.managerUserId && order.manager.trim().toLocaleLowerCase("ru") === scope.managerName?.trim().toLocaleLowerCase("ru") ? scope.managerUserId : null), happenedAt, orderOwnership.get(order.id));
  if (scope.managerUserId) {
    const managerId = scope.managerUserId;
    clients = clients.filter((item) => ownerAt(item.managerUserId, item.createdAt, leadOwnership.get(item.id)) === managerId);
    previousClients = previousClients.filter((item) => ownerAt(item.managerUserId, item.createdAt, leadOwnership.get(item.id)) === managerId);
    orders = orders.filter((item) => historicalOwner(item, item.orderReceivedAt) === managerId);
    previousOrders = previousOrders.filter((item) => historicalOwner(item, item.orderReceivedAt) === managerId);
    measurements = measurements.filter((item) => item.order ? historicalOwner(item.order, item.visitDate) === managerId : ownerAt(item.client.managerUserId, item.visitDate, leadOwnership.get(item.clientId)) === managerId);
    previousMeasurementRows = previousMeasurementRows.filter((item) => item.order ? historicalOwner(item.order, item.visitDate) === managerId : ownerAt(item.client.managerUserId, item.visitDate, leadOwnership.get(item.clientId)) === managerId);
    payments = payments.filter((item) => item.order && historicalOwner(item.order, item.operationDate) === managerId);
    previousPayments = previousPayments.filter((item) => item.order && historicalOwner(item.order, item.operationDate) === managerId);
  }
  const previousMeasurements = previousMeasurementRows.length;
  const completedCount = scope.managerUserId ? completed.filter((item) => item.completedAt && historicalOwner(item, item.completedAt) === scope.managerUserId).length : completed.length;
  const internalFinance = leadership(actor.role) || actor.role === Role.ACCOUNTANT;
  const payrollPeriodFrom = Number(period.dateFrom.slice(0, 7).replace("-", ""));
  const payrollPeriodTo = Number(period.dateTo.slice(0, 7).replace("-", ""));
  const [customerBalance, partnerBalance, payrollSnapshots, payrollPayments, expenseEntries] = await Promise.all([
    prisma.order.aggregate({ where: { ...currentOrderScope, lifecycle: { not: "CANCELLED" } }, _sum: { balance: true } }),
    prisma.order.aggregate({ where: { ...currentOrderScope, lifecycle: { not: "CANCELLED" }, partnerId: { not: null }, partnerAgreedAt: { not: null }, partnerPrice: { gte: MIN_PRODUCTION_PRICE } }, _sum: { partnerBalance: true } }),
    internalFinance
      ? prisma.payrollCalculationSnapshot.findMany({
          where: { companyId },
          select: {
            id: true,
            employeeId: true,
            periodId: true,
            revision: true,
            preparedAmount: true,
            period: { select: { year: true, month: true } },
          },
        })
      : Promise.resolve([]),
    internalFinance
      ? prisma.payrollPayment.findMany({
          where: {
            employee: { companyId },
            reversalOfId: null,
            reversedAt: null,
          },
          select: {
            employeeId: true,
            periodId: true,
            amount: true,
            type: true,
            paymentDate: true,
          },
        })
      : Promise.resolve([]),
    internalFinance
      ? prisma.companyLedgerEntry.findMany({
          where: {
            companyId,
            direction: { in: ["INCOME", "EXPENSE"] },
            operationDate: range(period.start, period.end),
            affectsProfit: true,
            voidedAt: null,
            orderId: null,
          },
          select: { amount: true, direction: true, category: true, source: true, type: true, orderId: true, affectsProfit: true },
        })
      : Promise.resolve([]),
  ]);
  const received = payments.reduce((sum, item) => sum + paymentEffect(item.type, item.amount), 0);
  const previousReceived = previousPayments.reduce((sum, item) => sum + paymentEffect(item.type, item.amount), 0);
  const salesAmount = orders.reduce((sum, item) => sum + money(item.amount), 0);
  const previousSales = previousOrders.reduce((sum, item) => sum + money(item.amount), 0);
  const cancelled = await prisma.order.count({ where: { ...orderScope, lifecycle: "CANCELLED", orderDateNeedsReview: false, orderReceivedAt: range(period.start, period.end) } });
  const managerMap = new Map(managerUsers.filter((user) => user.active || Boolean(user.payrollProfile?.terminatedAt && user.payrollProfile.hiredAt <= period.end && user.payrollProfile.terminatedAt >= period.start)).map((user) => [user.id, { id: user.id, name: user.name, active: user.active, leads: 0, measurements: 0, orders: 0, salesAmount: 0, received: 0, completed: 0, overdue: 0, conversion: null as number | null }]));
  const managerByName = new Map(managerUsers.map((user) => [user.name.trim().toLocaleLowerCase("ru"), user.id]));
  const managerIdForOrder = (order: { id: number; managerUserId: number | null; manager: string; responsibleType: OrderResponsibleType }, happenedAt: Date) => order.responsibleType === OrderResponsibleType.COMPANY ? null : ownerAt(order.managerUserId ?? managerByName.get(order.manager.trim().toLocaleLowerCase("ru")) ?? null, happenedAt, orderOwnership.get(order.id));
  clients.forEach((item) => { const id = ownerAt(item.managerUserId, item.createdAt, leadOwnership.get(item.id)); if (id && managerMap.has(id)) managerMap.get(id)!.leads += 1; });
  measurements.forEach((item) => { const id = item.order ? managerIdForOrder(item.order, item.visitDate) : ownerAt(item.client.managerUserId, item.visitDate, leadOwnership.get(item.clientId)); if (id && managerMap.has(id)) managerMap.get(id)!.measurements += 1; });
  orders.forEach((item) => { const id = managerIdForOrder(item, item.orderReceivedAt); if (id && managerMap.has(id)) { const row = managerMap.get(id)!; row.orders += 1; row.salesAmount += money(item.amount); if (item.lifecycle === "COMPLETED") row.completed += 1; const due = item.promisedAt ?? item.productionDeadline ?? item.installation?.scheduledAt; if (item.lifecycle !== "COMPLETED" && due && due < new Date()) row.overdue += 1; } });
  payments.forEach((item) => { const id = item.order ? managerIdForOrder(item.order, item.operationDate) : null; if (id && managerMap.has(id)) managerMap.get(id)!.received += paymentEffect(item.type, item.amount); });
  const managers = [...managerMap.values()].map((item) => ({ ...item, conversion: safePercent(item.orders, item.leads) })).sort((a, b) => b.salesAmount - a.salesAmount);
  const trendMap = new Map<string, { date: string; salesAmount: number; received: number }>();
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: period.timezone }).format(date);
  orders.forEach((item) => { const key = day(item.orderReceivedAt); const value = trendMap.get(key) ?? { date: key, salesAmount: 0, received: 0 }; value.salesAmount += money(item.amount); trendMap.set(key, value); });
  payments.forEach((item) => { const key = day(item.operationDate); const value = trendMap.get(key) ?? { date: key, salesAmount: 0, received: 0 }; value.received += paymentEffect(item.type, item.amount); trendMap.set(key, value); });
  const missingProductionPrice = orders.filter(
    (item) => !hasProductionPrice(item.partnerPrice, item.partnerAgreedAt),
  ).length;
  const pricedOrders = orders.filter(
    (item) =>
      money(item.amount) > 0 &&
      hasProductionPrice(item.partnerPrice, item.partnerAgreedAt),
  );
  const productionCost = pricedOrders.reduce(
    (sum, item) => sum + money(item.partnerPrice),
    0,
  );
  const pricedSales = pricedOrders.reduce(
    (sum, item) => sum + money(item.amount),
    0,
  );
  const grossMargin = pricedSales - productionCost;
  const completionTasks = orders
    .map((order) => ({
      orderId: order.id,
      number: order.number,
      client: order.client.name,
      manager: order.responsibleType === OrderResponsibleType.COMPANY ? "Компания" : order.manager || "Не назначен",
      missingFields: orderDataGaps(order),
    }))
    .filter((item) => item.missingFields.length > 0);
  const includeFullDetails = params.get("export") === "csv";
  const visibleCompletionTasks = includeFullDetails ? completionTasks : completionTasks.slice(0, 20);
  const visibleOrders = includeFullDetails ? orders : orders.slice(0, 20);
  const currentCustomerRemaining = Math.max(Number(customerBalance._sum.balance ?? 0), 0);
  const currentPartnerRemaining = Math.max(Number(partnerBalance._sum.partnerBalance ?? 0), 0);
  const latestPayrollSnapshots = latestApprovedPayrollSnapshots(payrollSnapshots);
  const payrollAccounting = approvedPayrollAccountingTotals(
    payrollSnapshots,
    payrollPayments,
  );
  const payrollAccrued = latestPayrollSnapshots.reduce((sum, snapshot) => {
    const periodKey = snapshot.period.year * 100 + snapshot.period.month;
    return periodKey >= payrollPeriodFrom && periodKey <= payrollPeriodTo
      ? sum + Number(snapshot.preparedAmount)
      : sum;
  }, 0);
  const payrollPaid = payrollPayments.reduce(
    (sum, payment) =>
      payment.paymentDate >= period.start && payment.paymentDate <= period.end
        ? sum + signedConfirmedPayrollPayment(payment)
        : sum,
    0,
  );
  const operatingExpenses = expenseEntries
    .filter(isOperatingProfitExpense)
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  const additionalIncome = expenseEntries
    .filter(isAdditionalProfitIncome)
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  const expenseCategoryMap = new Map<string, number>();
  expenseEntries
    .filter(isOperatingProfitExpense)
    .forEach((entry) =>
      expenseCategoryMap.set(
        entry.category,
        (expenseCategoryMap.get(entry.category) ?? 0) + Number(entry.amount),
      ),
    );
  const expensesByCategory = [...expenseCategoryMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  const recordedExpenses = operatingExpenses;
  const netProfit =
    grossMargin + additionalIncome - operatingExpenses - payrollAccrued;
  const partnerAgreed = orders
    .filter((item) => hasProductionPrice(item.partnerPrice, item.partnerAgreedAt))
    .reduce((sum, item) => sum + money(item.partnerPrice), 0);
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
    sales: { count: orders.length, amount: salesAmount, averageOrder: orders.length ? salesAmount / orders.length : 0, completed: completedCount, cancelled, ...(leadership(actor.role) ? { grossMargin, ordersWithMargin: pricedOrders.length } : {}) },
    payments: { received, remaining: currentCustomerRemaining },
    dataQuality: { missingProductionPrice, incompleteOrders: completionTasks.length, tasks: visibleCompletionTasks },
    ...(internalFinance ? { finance: { sales: salesAmount, customerReceived: received, customerRemaining: currentCustomerRemaining, partnerAgreed, partnerPaid, partnerRemaining: currentPartnerRemaining, productionCost, grossMargin, grossMarginRate: safePercent(grossMargin, pricedSales), ordersWithMargin: pricedOrders.length, ordersWithoutMargin: orders.length - pricedOrders.length, additionalIncome, operatingExpenses, expensesByCategory, recordedExpenses, netProfit: actor.role === Role.OPERATIONS_DIRECTOR || pricedOrders.length !== orders.length ? null : netProfit, payrollAccrued: actor.role === Role.OPERATIONS_DIRECTOR ? null : payrollAccrued, payrollPaid: actor.role === Role.OPERATIONS_DIRECTOR ? null : payrollPaid, payrollPayable: actor.role === Role.OPERATIONS_DIRECTOR ? null : payrollAccounting.payable } } : {}),
    funnel: [
      { key: "leads", label: "Заявки", value: clients.length, conversionFromPrevious: null },
      { key: "measurements", label: "Замеры", value: measurements.length, conversionFromPrevious: safePercent(measurements.length, clients.length) },
      { key: "orders", label: "Заказы", value: orders.length, conversionFromPrevious: safePercent(orders.length, measurements.length) },
    ], managers,
    trend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    production: production.map((item) => ({ stage: item.stage, count: item._count._all })),
    orders: visibleOrders.map((item) => {
      const paid = item.payments.reduce((sum, payment) => sum + paymentEffect(payment.type, payment.amount), 0);
      const productionPrice = hasProductionPrice(item.partnerPrice, item.partnerAgreedAt)
        ? money(item.partnerPrice)
        : null;
      return { id: item.id, number: item.number, client: item.client.name, manager: item.responsibleType === OrderResponsibleType.COMPANY ? "Компания" : item.manager, amount: money(item.amount), productionPrice, grossMargin: productionPrice === null || money(item.amount) <= 0 ? null : money(item.amount) - productionPrice, payrollAccrued: null, received: paid, remaining: Math.max(0, money(item.amount) - paid), status: USER_ORDER_STATUS_LABELS[projectOrderStatus(item.lifecycle)] };
    }),
  };
}
