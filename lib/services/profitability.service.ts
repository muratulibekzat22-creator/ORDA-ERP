import {
  MarketingSpendStatus,
  PartnerSettlementOperationStatus,
  PartnerSettlementOperationType,
  PayrollDirection,
  Prisma,
} from "@prisma/client";

import {
  calculateOrderEconomy,
  type OrderEconomyInput,
} from "@/lib/orders/economy";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal.Value = 0) =>
  new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

async function sequentialQueries<T extends readonly (() => Promise<unknown>)[]>(tasks: T) {
  const values: unknown[] = [];
  for (const task of tasks) values.push(await task());
  return values as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

export const profitabilityOrderInclude = {
  client: { select: { id: true, name: true, phone: true, city: true } },
  partner: { select: { id: true, name: true } },
  managerUser: { select: { id: true, name: true, active: true } },
  payments: true,
  commercialAdjustments: { orderBy: { createdAt: "asc" as const } },
  companyLedgerEntries: { orderBy: { operationDate: "asc" as const } },
  costPlan: true,
  payrollAccruals: {
    include: {
      employee: {
        include: { user: { select: { id: true, name: true, role: true } } },
      },
      payments: true,
      reversedBy: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  partnerRelation: {
    include: {
      createdBy: { select: { name: true } },
      operations: {
        where: { status: PartnerSettlementOperationStatus.POSTED },
        orderBy: { operationDate: "asc" as const },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export type ProfitabilityOrder = Prisma.OrderGetPayload<{
  include: typeof profitabilityOrderInclude;
}>;

export type ProfitabilityActor = { userId: number; name: string };

export async function saveOrderCostPlan(
  orderId: number,
  input: {
    materialOutsideWorkshop: Prisma.Decimal.Value;
    delivery: Prisma.Decimal.Value;
    bankFees: Prisma.Decimal.Value;
    otherDirect: Prisma.Decimal.Value;
    confirmed: boolean;
  },
  actor: ProfitabilityActor,
) {
  const companyId = requireTenantIdentity().companyId;
  const values = {
    materialOutsideWorkshop: money(input.materialOutsideWorkshop),
    delivery: money(input.delivery),
    bankFees: money(input.bankFees),
    otherDirect: money(input.otherDirect),
  };
  if (Object.values(values).some((value) => value.lt(0)))
    throw new Error("INVALID_ORDER_COST_PLAN");
  const confirmedAt = input.confirmed ? new Date() : null;
  const order = await prisma.order.findFirst({
    where: { id: orderId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const snapshot = {
    ...Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.toFixed(2)]),
    ),
    confirmedAt: confirmedAt?.toISOString() ?? null,
  } satisfies Prisma.InputJsonObject;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.orderCostPlan.upsert({
      where: { orderId },
      create: {
        companyId,
        orderId,
        ...values,
        confirmedAt,
        updatedById: actor.userId,
        updatedByName: actor.name,
      },
      update: {
        ...values,
        confirmedAt,
        updatedById: actor.userId,
        updatedByName: actor.name,
      },
    });
    await tx.orderCostPlanRevision.create({
      data: {
        companyId,
        orderId,
        actorId: actor.userId,
        actorName: actor.name,
        snapshot,
      },
    });
    await tx.orderEvent.create({
      data: {
        companyId,
        orderId,
        title: confirmedAt
          ? "Расходы заказа подтверждены"
          : "Плановые расходы заказа обновлены",
        description:
          "Материал вне цеха, доставка, банковские комиссии и другие прямые расходы",
        user: actor.name,
      },
    });
    return plan;
  });
}

/** Pure canonical entry point used by order, partner, finance and reports. */
export function calculateOrderProfitability(input: OrderEconomyInput) {
  return calculateOrderEconomy(input);
}

export function calculateLoadedOrderProfitability(order: ProfitabilityOrder) {
  const relation =
    order.partnerRelation?.companyId === order.companyId
      ? order.partnerRelation
      : null;
  const adjustments = relation?.operations.reduce(
    (sum, operation) =>
      operation.type === PartnerSettlementOperationType.ADJUSTMENT ||
      operation.type === PartnerSettlementOperationType.REVERSAL
        ? sum.add(operation.adjustmentEffect)
        : sum,
    zero(),
  ) ?? zero();
  const partnerAccrued = order.partnerAgreedAt
    ? money(order.partnerPrice).add(adjustments)
    : zero();

  return calculateOrderProfitability({
    totalSale: order.amount,
    commercialAdjustments: order.commercialAdjustments,
    payments: order.payments,
    partnerId: relation?.partnerId ?? order.partnerId,
    partnerAgreed: order.partnerPrice,
    partnerAccrued,
    partnerAgreedAt: order.partnerAgreedAt,
    partnerAgreedBy: relation?.createdBy.name ?? null,
    partnerDueAt: relation?.paymentDueAt ?? order.partnerPlannedReadyAt,
    clientDueAt: order.promisedAt,
    partnerDisputed: relation?.settlementStatus === "DISPUTED",
    lifecycle: order.lifecycle,
    payrollAccruals: order.payrollAccruals,
    ledgerEntries: order.companyLedgerEntries,
    costPlan: order.costPlan,
  });
}

type Period = { from?: Date; to?: Date; managerUserId?: number };
const dateFilter = (period: Period) =>
  period.from || period.to
    ? { gte: period.from, lte: period.to }
    : undefined;

function aggregateProducts(rows: ReturnType<typeof companyRow>[]) {
  const groups = new Map<
    string,
    {
      product: string;
      material: string;
      orders: number;
      sales: Prisma.Decimal;
      profit: Prisma.Decimal;
      marginTotal: Prisma.Decimal;
      calculated: number;
    }
  >();
  for (const row of rows) {
    const product = row.staircase.trim() || "Тип изделия не указан";
    const material = row.material.trim() || "Материал не указан";
    const key = `${product}\u0000${material}`;
    const group = groups.get(key) ?? {
      product,
      material,
      orders: 0,
      sales: zero(),
      profit: zero(),
      marginTotal: zero(),
      calculated: 0,
    };
    group.orders += 1;
    group.sales = group.sales.add(row.economy.client.totalSale);
    if (row.economy.profit.complete) {
      group.profit = group.profit.add(row.economy.profit.netProfit);
      group.marginTotal = group.marginTotal.add(
        row.economy.profit.netMarginPercent,
      );
      group.calculated += 1;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    averageProfit: group.calculated
      ? group.profit.div(group.calculated).toDecimalPlaces(2)
      : zero(),
    averageMargin: group.calculated
      ? group.marginTotal.div(group.calculated).toDecimalPlaces(2)
      : zero(),
  }));
}

function companyRow(order: ProfitabilityOrder) {
  return {
    id: order.id,
    number: order.number,
    lifecycle: order.lifecycle,
    status: order.status,
    createdAt: order.createdAt,
    orderReceivedAt: order.orderReceivedAt,
    completedAt: order.completedAt,
    staircase: order.staircase,
    material: order.material,
    client: order.client,
    partner: order.partner,
    manager: order.managerUser ?? {
      id: order.managerUserId,
      name: order.manager,
      active: false,
    },
    economy: calculateLoadedOrderProfitability(order),
  };
}

function firstBy<T>(items: T[], compare: (left: T, right: T) => number) {
  return items.length ? [...items].sort(compare)[0] : null;
}

/**
 * Company profitability separates accrual profit from cash movement. Order
 * costs with orderId never enter general expenses; linked marketing spend is
 * represented by its single finance entry.
 */
export async function getCompanyProfitability(period: Period = {}) {
  const companyId = requireTenantIdentity().companyId;
  const operationDate = dateFilter(period);
  const [orders, generalLedger, generalPayroll, unlinkedMarketing] =
    await sequentialQueries([
      () => prisma.order.findMany({
        where: {
          companyId,
          deletedAt: null,
          lifecycle: { not: "CANCELLED" },
          ...(period.managerUserId ? { managerUserId: period.managerUserId } : {}),
          ...(dateFilter(period)
            ? { orderReceivedAt: dateFilter(period) }
            : {}),
        },
        include: profitabilityOrderInclude,
        orderBy: [{ orderReceivedAt: "desc" }, { id: "desc" }],
      }),
      () => prisma.companyLedgerEntry.findMany({
        where: {
          companyId,
          orderId: null,
          voidedAt: null,
          affectsProfit: true,
          ...(operationDate ? { operationDate } : {}),
        },
        select: {
          amount: true,
          direction: true,
          source: true,
          type: true,
          category: true,
          categoryRef: { select: { code: true, name: true } },
        },
      }),
      () => prisma.payrollAccrual.findMany({
        where: {
          orderId: null,
          reversalOfId: null,
          reversedBy: null,
          employee: { companyId },
          ...(dateFilter(period) ? { createdAt: dateFilter(period) } : {}),
        },
        select: { amount: true, direction: true },
      }),
      () => prisma.marketingSpend.findMany({
        where: {
          companyId,
          status: {
            in: [
              MarketingSpendStatus.APPROVED,
              MarketingSpendStatus.RECONCILED,
            ],
          },
          financeEntryId: null,
          ...(dateFilter(period) ? { spendDate: dateFilter(period) } : {}),
        },
        select: { amount: true },
      }),
    ] as const);

  const rows = orders.map(companyRow);
  const calculable = rows.filter((row) => row.economy.profit.complete);
  const sales = rows.reduce(
    (sum, row) => sum.add(row.economy.client.totalSale),
    zero(),
  );
  const orderProfit = calculable.reduce(
    (sum, row) => sum.add(row.economy.profit.netProfit),
    zero(),
  );
  const clientReceived = rows.reduce(
    (sum, row) => sum.add(row.economy.client.netReceived),
    zero(),
  );
  const clientOutstanding = rows.reduce(
    (sum, row) => sum.add(row.economy.client.remaining),
    zero(),
  );
  const partnerPaid = rows.reduce(
    (sum, row) => sum.add(row.economy.partner.paid),
    zero(),
  );
  const partnerPayable = rows.reduce(
    (sum, row) => sum.add(row.economy.partner.remaining),
    zero(),
  );
  const payrollPaid = rows.reduce(
    (sum, row) => sum.add(row.economy.cash.payrollPaid),
    zero(),
  );
  const otherOrderCashExpenses = rows.reduce(
    (sum, row) => sum.add(row.economy.cash.otherExpensesPaid),
    zero(),
  );

  let otherIncome = zero();
  let generalExpenses = zero();
  let mandatoryPayments = zero();
  let generalCashExpenses = zero();
  for (const entry of generalLedger) {
    if (entry.direction === "INCOME") {
      otherIncome = otherIncome.add(entry.amount);
      continue;
    }
    generalCashExpenses = generalCashExpenses.add(entry.amount);
    if (entry.source === "PAYROLL_PAYMENT") continue;
    const category = `${entry.categoryRef?.code ?? ""} ${
      entry.categoryRef?.name ?? ""
    } ${entry.category} ${entry.type}`;
    if (/TAX|SOCIAL|MANDATORY|НАЛОГ|СОЦИАЛ|ОБЯЗАТ/i.test(category))
      mandatoryPayments = mandatoryPayments.add(entry.amount);
    else generalExpenses = generalExpenses.add(entry.amount);
  }
  const generalPayrollAccrued = generalPayroll.reduce(
    (sum, accrual) =>
      accrual.direction === PayrollDirection.DECREASE
        ? sum.sub(accrual.amount)
        : sum.add(accrual.amount),
    zero(),
  );
  const unlinkedMarketingExpense = unlinkedMarketing.reduce(
    (sum, spend) => sum.add(spend.amount),
    zero(),
  );
  generalExpenses = generalExpenses
    .add(generalPayrollAccrued)
    .add(unlinkedMarketingExpense);

  const profitBeforeMandatory = orderProfit
    .add(otherIncome)
    .sub(generalExpenses);
  const companyNetProfit = profitBeforeMandatory.sub(mandatoryPayments);
  const averageMargin = calculable.length
    ? calculable
        .reduce(
          (sum, row) => sum.add(row.economy.profit.netMarginPercent),
          zero(),
        )
        .div(calculable.length)
        .toDecimalPlaces(2)
    : zero();
  const cashResult = clientReceived
    .add(otherIncome)
    .sub(partnerPaid)
    .sub(payrollPaid)
    .sub(otherOrderCashExpenses)
    .sub(generalCashExpenses);

  const products = aggregateProducts(rows);
  const profitable = rows.filter((row) => row.economy.profit.complete);
  const partnerMap = new Map<
    number,
    { id: number; name: string; orders: number; profit: Prisma.Decimal }
  >();
  const managerMap = new Map<
    number,
    { id: number; name: string; orders: number; profit: Prisma.Decimal }
  >();
  for (const row of profitable) {
    if (row.partner) {
      const value = partnerMap.get(row.partner.id) ?? {
        ...row.partner,
        orders: 0,
        profit: zero(),
      };
      value.orders += 1;
      value.profit = value.profit.add(row.economy.profit.netProfit);
      partnerMap.set(row.partner.id, value);
    }
    if (row.manager.id && row.manager.active) {
      const value = managerMap.get(row.manager.id) ?? {
        id: row.manager.id,
        name: row.manager.name,
        orders: 0,
        profit: zero(),
      };
      value.orders += 1;
      value.profit = value.profit.add(row.economy.profit.netProfit);
      managerMap.set(row.manager.id, value);
    }
  }

  return {
    period,
    rows,
    totals: {
      sales,
      orderProfit,
      profitBeforeMandatory,
      companyNetProfit,
      averageMargin,
      clientReceived,
      clientOutstanding,
      partnerPaid,
      partnerPayable,
      payrollPaid,
      otherExpensesPaid: otherOrderCashExpenses.add(generalCashExpenses),
      otherIncome,
      generalExpenses,
      mandatoryPayments,
      cashResult,
      calculatedOrders: calculable.length,
      incompleteOrders: rows.length - calculable.length,
      activeOrders: rows.filter(
        (row) => row.lifecycle !== "COMPLETED" && row.lifecycle !== "CANCELLED",
      ).length,
      completedOrders: rows.filter((row) => row.lifecycle === "COMPLETED")
        .length,
    },
    products,
    highlights: {
      highestProfit: firstBy(profitable, (a, b) =>
        b.economy.profit.netProfit.comparedTo(a.economy.profit.netProfit),
      ),
      highestMargin: firstBy(profitable, (a, b) =>
        b.economy.profit.netMarginPercent.comparedTo(
          a.economy.profit.netMarginPercent,
        ),
      ),
      lowestProfit: firstBy(profitable, (a, b) =>
        a.economy.profit.netProfit.comparedTo(b.economy.profit.netProfit),
      ),
      mostPopularProduct: firstBy(products, (a, b) =>
        b.orders - a.orders || b.sales.comparedTo(a.sales),
      ),
      topSellingProduct: firstBy(products, (a, b) =>
        b.sales.comparedTo(a.sales),
      ),
      mostProfitableProduct: firstBy(products, (a, b) =>
        b.profit.comparedTo(a.profit),
      ),
      highestMarginProduct: firstBy(products, (a, b) =>
        b.averageMargin.comparedTo(a.averageMargin),
      ),
      mostProfitablePartner: firstBy([...partnerMap.values()], (a, b) =>
        b.profit.comparedTo(a.profit),
      ),
      mostEffectiveManager: firstBy([...managerMap.values()], (a, b) =>
        b.profit.comparedTo(a.profit),
      ),
    },
  };
}
