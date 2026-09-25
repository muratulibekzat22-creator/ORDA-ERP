import {
  OrderLifecycle,
  PayrollDirection,
  PayrollPaymentType,
  Prisma,
  Role,
} from "@prisma/client";

import { calculateOrderEconomy } from "@/lib/orders/economy";
import {
  isOrderOverdue,
  orderDeadline,
  projectOrderStatus,
  type UserOrderStatus,
} from "@/lib/orders/presentation";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

type DashboardScope = {
  role: Role;
  userId: number;
  period?: string;
  month?: string;
};

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function dashboardPeriodRange(period = "month", now = new Date()) {
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const startDay = period === "today" ? day : period === "week" ? day - 6 : 1;
  return {
    start: new Date(Date.UTC(year, month, startDay) - ALMATY_OFFSET_MS),
    end: now,
  };
}

export function dashboardMonthRange(month?: string, now = new Date()) {
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const year = match ? Number(match[1]) : local.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : local.getUTCMonth();
  if (year < 2000 || year > 2200 || monthIndex < 0 || monthIndex > 11)
    throw new Error("INVALID_MONTH");
  return {
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    year,
    month: monthIndex + 1,
    start: new Date(Date.UTC(year, monthIndex, 1) - ALMATY_OFFSET_MS),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - ALMATY_OFFSET_MS),
  };
}

const orderEconomySelect = {
  id: true,
  number: true,
  amount: true,
  prepayment: true,
  balance: true,
  partnerId: true,
  partnerPrice: true,
  partnerAgreedAt: true,
  partnerPlannedReadyAt: true,
  promisedAt: true,
  productionDeadline: true,
  lifecycle: true,
  orderReceivedAt: true,
  manager: true,
  client: { select: { name: true } },
  installation: { select: { scheduledAt: true } },
  commercialAdjustments: { select: { balanceImpact: true } },
  payrollAccruals: {
    select: {
      type: true,
      direction: true,
      amount: true,
      reversalOfId: true,
      reversedBy: { select: { id: true } },
      employee: {
        select: {
          position: true,
          user: { select: { role: true } },
        },
      },
      payments: {
        select: {
          amount: true,
          reversalOfId: true,
          reversedAt: true,
        },
      },
    },
  },
  companyLedgerEntries: {
    select: {
      direction: true,
      amount: true,
      source: true,
      category: true,
      type: true,
      affectsProfit: true,
      voidedAt: true,
    },
  },
  calculations: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      workshopCost: true,
      materialCost: true,
      installationCost: true,
      deliveryCost: true,
      otherDirectCosts: true,
    },
  },
} satisfies Prisma.OrderSelect;

function economyFor(order: Prisma.OrderGetPayload<{ select: typeof orderEconomySelect }>) {
  return calculateOrderEconomy({
    totalSale: order.amount,
    commercialAdjustments: order.commercialAdjustments,
    partnerId: order.partnerId,
    partnerAgreed: order.partnerPrice,
    partnerAgreedAt: order.partnerAgreedAt,
    partnerDueAt: order.partnerPlannedReadyAt,
    clientDueAt: order.promisedAt,
    payrollAccruals: order.payrollAccruals,
    ledgerEntries: order.companyLedgerEntries,
    calculation: order.calculations[0] ?? null,
  });
}

const signedAccrual = (row: { amount: Prisma.Decimal; direction: PayrollDirection }) =>
  Number(row.amount) * (row.direction === PayrollDirection.INCREASE ? 1 : -1);
const signedPayment = (row: { amount: Prisma.Decimal; type: PayrollPaymentType }) =>
  Number(row.amount) * (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -1 : 1);

async function managementProjection(scope: DashboardScope) {
  const companyId = requireTenantIdentity().companyId;
  const period = dashboardMonthRange(scope.month ?? scope.period);
  const now = new Date();
  const activeLifecycles: Prisma.EnumOrderLifecycleFilter = {
    notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED],
  };

  type DashboardOrder = Prisma.OrderGetPayload<{
    select: typeof orderEconomySelect;
  }>;

  const [orders, payments, ledgerEntries, payrollPeriod] = await Promise.all([
    prisma.order.findMany({
      where: {
        companyId,
        deletedAt: null,
        lifecycle: { not: OrderLifecycle.CANCELLED },
        OR: [
          { lifecycle: activeLifecycles },
          { orderReceivedAt: { gte: period.start, lt: period.end } },
        ],
      },
      select: orderEconomySelect,
      orderBy: [{ promisedAt: "asc" }, { createdAt: "desc" }],
    }) as Promise<DashboardOrder[]>,
    prisma.payment.groupBy({
      by: ["type"],
      where: {
        operationDate: { gte: period.start, lt: period.end },
        type: {
          in: [
            "CLIENT_PAYMENT",
            "payment",
            "PREPAYMENT",
            "ADDITIONAL_PAYMENT",
            "REFUND",
          ],
        },
        order: {
          companyId,
          deletedAt: null,
          lifecycle: { not: OrderLifecycle.CANCELLED },
        },
      },
      _sum: { amount: true },
    }),
    prisma.companyLedgerEntry.findMany({
      where: {
        companyId,
        direction: "EXPENSE",
        operationDate: { gte: period.start, lt: period.end },
        voidedAt: null,
      },
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      select: {
        id: true,
        type: true,
        category: true,
        source: true,
        amount: true,
        operationDate: true,
        comment: true,
        orderId: true,
        affectsProfit: true,
        order: { select: { number: true } },
      },
    }),
    prisma.payrollPeriod.findUnique({
      where: {
        companyId_year_month: {
          companyId,
          year: period.year,
          month: period.month,
        },
      },
      select: { id: true },
    }),
  ]);

  const [payrollAccruals, payrollPayments] = await Promise.all([
    payrollPeriod
      ? prisma.payrollAccrual.findMany({
          where: { periodId: payrollPeriod.id, reversalOfId: null },
          select: {
            amount: true,
            direction: true,
            reversedBy: { select: { id: true } },
          },
        })
      : Promise.resolve([]),
    payrollPeriod
      ? prisma.payrollPayment.findMany({
          where: {
            periodId: payrollPeriod.id,
            paymentDate: { gte: period.start, lt: period.end },
            reversalOfId: null,
            reversedAt: null,
          },
          select: { amount: true, type: true },
        })
      : Promise.resolve([]),
  ]);

  const periodOrders = orders.filter(
    (order) => order.orderReceivedAt >= period.start && order.orderReceivedAt < period.end,
  );
  const activeOrders = orders.filter(
    (order) =>
      order.lifecycle !== OrderLifecycle.COMPLETED &&
      order.lifecycle !== OrderLifecycle.CANCELLED,
  );
  const periodEconomies = periodOrders.map((order) => ({
    order,
    economy: economyFor(order),
  }));
  const revenue = periodOrders.reduce((sum, order) => sum + Number(order.amount), 0);
  const received = payments.reduce((sum, row) => {
    const amount = Number(row._sum.amount ?? 0);
    return sum + (row.type === "REFUND" ? -amount : amount);
  }, 0);
  const directExpenses = periodEconomies.reduce(
    (sum, item) => sum + Number(item.economy.profit.directExpenses),
    0,
  );
  const payrollAccrued = payrollAccruals
    .filter((row) => !row.reversedBy)
    .reduce((sum, row) => sum + signedAccrual(row), 0);
  const payrollPaid = payrollPayments.reduce(
    (sum, row) => sum + signedPayment(row),
    0,
  );
  const operatingEntries = ledgerEntries.filter(
    (entry) =>
      entry.orderId === null &&
      entry.affectsProfit &&
      !["PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "OTHER_SYSTEM"].includes(entry.source) &&
      entry.category !== "SALARY" &&
      entry.type !== "PARTNER_PAYOUT",
  );
  const operatingExpenses = operatingEntries.reduce(
    (sum, entry) => sum + Number(entry.amount),
    0,
  );
  const dataComplete = periodEconomies.every(
    (item) => item.economy.profit.dataComplete,
  );
  const netProfit = dataComplete
    ? revenue - directExpenses - payrollAccrued - operatingExpenses
    : null;
  const netMargin = netProfit !== null && revenue > 0
    ? Math.round((netProfit / revenue) * 10_000) / 100
    : null;

  const counts = Object.fromEntries(
    [
      "BEFORE_WORKSHOP",
      "TRANSFERRED_TO_WORKSHOP",
      "IN_WORK",
      "READY_FOR_INSTALLATION",
      "INSTALLATION",
    ].map((status) => [
      status,
      activeOrders.filter((order) => projectOrderStatus(order.lifecycle) === status).length,
    ]),
  ) as Record<UserOrderStatus, number>;
  const overdue = activeOrders.filter((order) =>
    isOrderOverdue(orderDeadline(order), order.lifecycle, now),
  ).length;
  const missingProductionPrice = activeOrders.filter(
    (order) =>
      order.partnerAgreedAt === null || Number(order.partnerPrice) <= 0,
  ).length;

  const attention = activeOrders
    .map((order) => {
      const economy = economyFor(order);
      const deadline = orderDeadline(order);
      const margin = economy.profit.netMarginPercent === null
        ? null
        : Number(economy.profit.netMarginPercent);
      const reasons = [
        isOrderOverdue(deadline, order.lifecycle, now) ? "Просрочен" : null,
        !deadline ? "Нет срока" : null,
        Number(order.balance) > 0 ? "Есть неоплаченный остаток" : null,
        !economy.profit.dataComplete ? "Не заполнена себестоимость" : null,
        margin !== null && margin < 15
          ? margin < 0
            ? "Отрицательная маржа"
            : "Низкая маржа"
          : null,
      ].filter((value): value is string => Boolean(value));
      return {
        id: order.id,
        number: order.number,
        client: order.client.name,
        responsible: order.manager,
        lifecycle: order.lifecycle,
        status: projectOrderStatus(order.lifecycle),
        deadline,
        balance: Number(order.balance),
        netProfit: economy.profit.netProfit === null
          ? null
          : Number(economy.profit.netProfit),
        netMargin: margin,
        reasons,
      };
    })
    .filter((order) => order.reasons.length > 0)
    .sort((left, right) => {
      const leftOverdue = left.reasons.includes("Просрочен") ? 0 : 1;
      const rightOverdue = right.reasons.includes("Просрочен") ? 0 : 1;
      return leftOverdue - rightOverdue;
    })
    .slice(0, 12);

  return {
    role: scope.role,
    month: period.key,
    finance: {
      revenue,
      received,
      directExpenses,
      operatingExpenses,
      payrollAccrued,
      payrollPaid,
      netProfit,
      netMargin,
      dataComplete,
    },
    orders: {
      active: activeOrders.length,
      beforeWorkshop: counts.BEFORE_WORKSHOP ?? 0,
      transferredToWorkshop: counts.TRANSFERRED_TO_WORKSHOP ?? 0,
      inWork: counts.IN_WORK ?? 0,
      readyForInstallation: counts.READY_FOR_INSTALLATION ?? 0,
      installation: counts.INSTALLATION ?? 0,
      overdue,
      missingProductionPrice,
    },
    attention,
    expenses: ledgerEntries
      .filter(
        (entry) =>
          !["PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "OTHER_SYSTEM"].includes(entry.source) &&
          entry.type !== "PARTNER_PAYOUT",
      )
      .slice(0, 30)
      .map((entry) => ({
        id: entry.id,
        category: entry.category,
        amount: Number(entry.amount),
        operationDate: entry.operationDate,
        comment: entry.comment,
        orderId: entry.orderId,
        orderNumber: entry.order?.number ?? null,
      })),
  };
}

async function managerProjection(scope: DashboardScope) {
  const now = new Date();
  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] },
    OR: [
      { managerUserId: scope.userId },
      { leadConversion: { managerId: scope.userId } },
    ],
  };
  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      number: true,
      lifecycle: true,
      promisedAt: true,
      productionDeadline: true,
      balance: true,
      partnerPrice: true,
      partnerAgreedAt: true,
      client: { select: { name: true } },
      installation: { select: { scheduledAt: true } },
    },
    orderBy: { promisedAt: "asc" },
    take: 50,
  });
  return {
    role: scope.role,
    orders: {
      active: orders.length,
      overdue: orders.filter((order) =>
        isOrderOverdue(orderDeadline(order), order.lifecycle, now),
      ).length,
      missingProductionPrice: orders.filter(
        (order) =>
          order.partnerAgreedAt === null || Number(order.partnerPrice) <= 0,
      ).length,
    },
    attention: orders
      .filter(
        (order) =>
          !orderDeadline(order) ||
          Number(order.balance) > 0 ||
          order.partnerAgreedAt === null ||
          Number(order.partnerPrice) <= 0,
      )
      .slice(0, 10)
      .map((order) => ({
        id: order.id,
        number: order.number,
        client: order.client.name,
        status: projectOrderStatus(order.lifecycle),
        deadline: orderDeadline(order),
        productionPriceMissing:
          order.partnerAgreedAt === null || Number(order.partnerPrice) <= 0,
      })),
  };
}

async function productionProjection(scope: DashboardScope) {
  const jobs = await prisma.production.findMany({
    where: {
      completedAt: null,
      archivedAt: null,
      order: { deletedAt: null },
      OR: [{ masterUserId: scope.userId }, { masterUserId: null }],
    },
    orderBy: [{ priority: "desc" }, { plannedEndAt: "asc" }],
    take: 30,
    select: {
      id: true,
      percent: true,
      priority: true,
      plannedEndAt: true,
      order: {
        select: {
          id: true,
          number: true,
          lifecycle: true,
          client: { select: { name: true } },
        },
      },
    },
  });
  return {
    role: scope.role,
    jobs: jobs.map((job) => ({
      ...job,
      status: projectOrderStatus(job.order.lifecycle),
      href: `/orders/${job.order.id}`,
    })),
  };
}

async function installerProjection(scope: DashboardScope) {
  const installations = await prisma.orderInstallation.findMany({
    where: {
      installerUserId: scope.userId,
      completedAt: null,
      order: {
        deletedAt: null,
        lifecycle: { not: OrderLifecycle.CANCELLED },
      },
    },
    orderBy: { scheduledAt: "asc" },
    take: 30,
    select: {
      id: true,
      scheduledAt: true,
      order: {
        select: {
          id: true,
          number: true,
          address: true,
          client: { select: { name: true } },
        },
      },
    },
  });
  return {
    role: scope.role,
    installations: installations.map((item) => ({
      ...item,
      href: `/orders/${item.order.id}`,
    })),
  };
}

export async function getDashboardSummary(scope: DashboardScope) {
  if (scope.role === Role.DIRECTOR || scope.role === Role.ACCOUNTANT)
    return managementProjection(scope);
  if (scope.role === Role.MANAGER) return managerProjection(scope);
  if (scope.role === Role.PRODUCTION) return productionProjection(scope);
  if (scope.role === Role.INSTALLER) return installerProjection(scope);
  throw new Error("DASHBOARD_ROLE_FORBIDDEN");
}
