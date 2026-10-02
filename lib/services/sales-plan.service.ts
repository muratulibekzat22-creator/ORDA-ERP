import { OrderLifecycle, Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type SalesPlanActor = { userId: number; role: Role };

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

const localDateKey = (value: Date) =>
  new Date(value.getTime() + ALMATY_OFFSET_MS).toISOString().slice(0, 10);

function monthRange(key?: string) {
  const now = new Date();
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const match = /^(\d{4})-(\d{2})$/.exec(key ?? "");
  const year = match ? Number(match[1]) : local.getUTCFullYear();
  const month = match ? Number(match[2]) : local.getUTCMonth() + 1;
  if (year < 2000 || year > 2200 || month < 1 || month > 12)
    throw new Error("INVALID_MONTH");
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    start: new Date(Date.UTC(year, month - 1, 1) - ALMATY_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - ALMATY_OFFSET_MS),
  };
}

function previousMonths(year: number, month: number, count = 3) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 2 - index, 1));
    return monthRange(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }).reverse();
}

const roundTarget = (value: number, step = 500_000) =>
  Math.max(step, Math.ceil(value / step) * step);

const roundPercent = (value: number) => Math.round(value * 100) / 100;

const roundUp = (value: number, step: number) =>
  Math.ceil(value / step) * step;

function recommendedMarketingTargets(revenueTarget: number, orderTarget: number) {
  const applicationTarget = Math.max(1, Math.ceil(orderTarget / 0.1));
  const inquiryTarget = Math.max(applicationTarget, Math.ceil(applicationTarget / 0.5));
  const marketingBudgetTarget = roundUp(inquiryTarget * 2_350, 5_000);
  return {
    marketingBudgetTarget,
    inquiryTarget,
    applicationTarget,
    assumptions: {
      inquiryToApplicationPercent: 50,
      applicationToOrderPercent: 10,
      targetCostPerInquiry: 2_350,
      marketingSharePercent: revenueTarget > 0
        ? roundPercent((marketingBudgetTarget / revenueTarget) * 100)
        : 0,
    },
  };
}

function paceStatus(actual: number, expected: number) {
  if (expected <= 0) return "not_started" as const;
  if (actual >= expected) return "ahead" as const;
  if (actual >= expected * 0.9) return "on_track" as const;
  return "behind" as const;
}

async function orderMetrics(start: Date, end: Date, managerId?: number) {
  const companyId = requireTenantIdentity().companyId;
  const orders = await prisma.order.findMany({
    where: {
      companyId,
      deletedAt: null,
      lifecycle: { not: OrderLifecycle.CANCELLED },
      orderReceivedAt: { gte: start, lt: end },
      ...(managerId
        ? {
            OR: [
              { managerUserId: managerId },
              { leadConversion: { managerId } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      amount: true,
      partnerPrice: true,
      partnerAgreedAt: true,
      managerUserId: true,
      leadConversion: { select: { managerId: true } },
    },
  });
  const revenue = orders.reduce((sum, order) => sum + Number(order.amount), 0);
  const priced = orders.filter(
    (order) => Number(order.partnerPrice) > 0 && Boolean(order.partnerAgreedAt),
  );
  const pricedRevenue = priced.reduce(
    (sum, order) => sum + Number(order.amount),
    0,
  );
  const productionCost = priced.reduce(
    (sum, order) => sum + Number(order.partnerPrice),
    0,
  );
  const grossMargin = pricedRevenue - productionCost;
  return {
    orders: orders.length,
    revenue,
    averageOrder: orders.length ? revenue / orders.length : 0,
    pricedOrders: priced.length,
    pricedRevenue,
    marginCoveragePercent: orders.length
      ? roundPercent((priced.length / orders.length) * 100)
      : 100,
    grossMargin,
    grossMarginPercent: pricedRevenue > 0
      ? roundPercent((grossMargin / pricedRevenue) * 100)
      : 0,
  };
}

async function recommendation(year: number, month: number) {
  const months = previousMonths(year, month);
  const history = await Promise.all(
    months.map(async (range) => ({
      month: range.key,
      ...(await orderMetrics(range.start, range.end)),
    })),
  );
  const nonEmpty = history.filter((row) => row.orders > 0);
  const weights = history.map((_, index) => index + 1);
  const weightedRevenue =
    history.reduce((sum, row, index) => sum + row.revenue * weights[index], 0) /
    weights.reduce((sum, value) => sum + value, 0);
  const bestRevenue = Math.max(0, ...history.map((row) => row.revenue));
  const baseRevenue = Math.max(weightedRevenue, bestRevenue);
  const revenueTarget = roundTarget(baseRevenue > 0 ? baseRevenue * 1.25 : 5_000_000);
  const totalOrders = nonEmpty.reduce((sum, row) => sum + row.orders, 0);
  const totalRevenue = nonEmpty.reduce((sum, row) => sum + row.revenue, 0);
  const averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 1_000_000;
  const orderTarget = Math.max(1, Math.ceil(revenueTarget / Math.max(averageOrder, 1)));
  const marketing = recommendedMarketingTargets(revenueTarget, orderTarget);
  return {
    revenueTarget,
    orderTarget,
    ...marketing,
    history: history.map((row) => ({
      month: row.month,
      orders: row.orders,
      revenue: row.revenue,
      averageOrder: row.averageOrder,
      pricedOrders: row.pricedOrders,
      pricedRevenue: row.pricedRevenue,
      marginCoveragePercent: row.marginCoveragePercent,
      grossMargin: row.grossMargin,
      grossMarginPercent: row.grossMarginPercent,
    })),
    basis: {
      method: "BEST_OR_WEIGHTED_3_MONTHS_PLUS_25_PERCENT",
      note: "База — лучший результат или взвешенная выручка трёх полных месяцев. Цель ставится на 25% выше базы.",
      months: history.map((row) => ({
        month: row.month,
        revenue: row.revenue,
        orders: row.orders,
      })),
      averageOrder,
    },
  };
}

const planInclude = {
  tiers: { orderBy: { position: "asc" as const } },
} satisfies Prisma.SalesPlanInclude;

async function ensurePlan(actor: SalesPlanActor, year: number, month: number) {
  const companyId = requireTenantIdentity().companyId;
  const found = await prisma.salesPlan.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    include: planInclude,
  });
  if (found || !([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] as Role[]).includes(actor.role))
    return found;
  const suggested = await recommendation(year, month);
  try {
    return await prisma.salesPlan.create({
      data: {
        companyId,
        year,
        month,
        revenueTarget: suggested.revenueTarget,
        orderTarget: suggested.orderTarget,
        recommendationRevenue: suggested.revenueTarget,
        recommendationOrders: suggested.orderTarget,
        recommendationBasis: suggested.basis,
        marketingBudgetTarget: suggested.marketingBudgetTarget,
        inquiryTarget: suggested.inquiryTarget,
        applicationTarget: suggested.applicationTarget,
        createdById: actor.userId,
        tiers: {
          create: [
            { thresholdPercent: 80, label: "Рабочий темп", rewardAmount: 0, position: 1 },
            { thresholdPercent: 100, label: "План выполнен", rewardAmount: 50_000, position: 2 },
            { thresholdPercent: 110, label: "Сильный результат", rewardAmount: 100_000, position: 3 },
            { thresholdPercent: 120, label: "Рекорд месяца", rewardAmount: 150_000, position: 4 },
          ],
        },
      },
      include: planInclude,
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
      throw error;
    return prisma.salesPlan.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
      include: planInclude,
    });
  }
}

export async function getSalesPlan(month: string | undefined, actor: SalesPlanActor) {
  const period = monthRange(month);
  const companyId = requireTenantIdentity().companyId;
  const [plan, actual, suggested, managers, applications, marketingMetrics, ledgerOrders] = await Promise.all([
    ensurePlan(actor, period.year, period.month),
    orderMetrics(period.start, period.end),
    recommendation(period.year, period.month),
    prisma.user.findMany({
      where: { companyId, active: true, role: Role.MANAGER },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.client.count({
      where: {
        companyId,
        active: true,
        deletedAt: null,
        createdAt: { gte: period.start, lt: period.end },
      },
    }),
    prisma.managementMarketingMetric.findMany({
      where: {
        companyId,
        metricMonth: { gte: period.start, lt: period.end },
      },
      select: { spend: true, leads: true },
    }),
    prisma.order.findMany({
      where: {
        companyId,
        deletedAt: null,
        lifecycle: { not: OrderLifecycle.CANCELLED },
        orderReceivedAt: { gte: period.start, lt: period.end },
      },
      select: {
        id: true,
        number: true,
        amount: true,
        orderReceivedAt: true,
        manager: true,
        managerUser: { select: { name: true } },
        client: { select: { name: true } },
      },
      orderBy: [{ orderReceivedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const now = new Date();
  const localNow = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const isCurrent =
    localNow.getUTCFullYear() === period.year &&
    localNow.getUTCMonth() + 1 === period.month;
  const daysInMonth = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const elapsedDays = isCurrent ? Math.max(1, localNow.getUTCDate()) : now >= period.end ? daysInMonth : 0;
  const projectedRevenue = elapsedDays > 0
    ? Math.round((actual.revenue / elapsedDays) * daysInMonth)
    : 0;
  const ledgerByDay = new Map<string, {
    date: string;
    revenue: number;
    orders: number;
    items: Array<{ id: number; number: string; client: string; manager: string; amount: number }>;
  }>();
  for (const order of ledgerOrders) {
    const key = localDateKey(order.orderReceivedAt);
    const row = ledgerByDay.get(key) ?? { date: key, revenue: 0, orders: 0, items: [] };
    row.revenue += Number(order.amount);
    row.orders += 1;
    row.items.push({
      id: order.id,
      number: order.number,
      client: order.client.name,
      manager: order.managerUser?.name ?? order.manager ?? "Не назначен",
      amount: Number(order.amount),
    });
    ledgerByDay.set(key, row);
  }
  const todayKey = localDateKey(now);
  if (isCurrent && !ledgerByDay.has(todayKey))
    ledgerByDay.set(todayKey, { date: todayKey, revenue: 0, orders: 0, items: [] });
  const dailySales = [...ledgerByDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  const todaySales = ledgerByDay.get(todayKey) ?? { date: todayKey, revenue: 0, orders: 0, items: [] };
  const canEdit = ([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] as Role[]).includes(actor.role);
  const minimumMarginPercent = Number(plan?.minimumMarginPercent ?? 25);
  const requiredCostCoveragePercent = Number(
    plan?.requiredCostCoveragePercent ?? 100,
  );
  const revenueTarget = Number(plan?.revenueTarget ?? suggested.revenueTarget);
  const fallbackMarketing = recommendedMarketingTargets(
    revenueTarget,
    plan?.orderTarget ?? suggested.orderTarget,
  );
  const marketingBudgetTarget = Number(plan?.marketingBudgetTarget ?? 0) > 0
    ? Number(plan?.marketingBudgetTarget)
    : fallbackMarketing.marketingBudgetTarget;
  const inquiryTarget = (plan?.inquiryTarget ?? 0) > 0
    ? Number(plan?.inquiryTarget)
    : fallbackMarketing.inquiryTarget;
  const applicationTarget = (plan?.applicationTarget ?? 0) > 0
    ? Number(plan?.applicationTarget)
    : fallbackMarketing.applicationTarget;
  const progressPercent = revenueTarget > 0
    ? roundPercent((actual.revenue / revenueTarget) * 100)
    : 0;
  const achievedTier = plan?.tiers
    .filter((tier) => progressPercent >= tier.thresholdPercent)
    .at(-1);
  const nextTier = plan?.tiers.find((tier) => progressPercent < tier.thresholdPercent);
  const bonusBlockers = [
    ...(progressPercent < 100 ? ["Командный план продаж не выполнен"] : []),
    ...(actual.marginCoveragePercent < requiredCostCoveragePercent
      ? [
          `Цена производства заполнена на ${actual.marginCoveragePercent}% из ${requiredCostCoveragePercent}%`,
        ]
      : []),
    ...(actual.grossMarginPercent < minimumMarginPercent
      ? [
          `Валовая маржа ${actual.grossMarginPercent}% ниже ${minimumMarginPercent}%`,
        ]
      : []),
  ];
  const visibleManagers = actor.role === Role.MANAGER
    ? managers.filter((manager) => manager.id === actor.userId)
    : managers;
  const managerProgress = await Promise.all(
    visibleManagers.map(async (manager) => {
      const metrics = await orderMetrics(period.start, period.end, manager.id);
      return {
        managerId: manager.id,
        managerName: manager.name,
        actualRevenue: metrics.revenue,
        actualOrders: metrics.orders,
        contributionPercent: actual.revenue > 0
          ? roundPercent((metrics.revenue / actual.revenue) * 100)
          : 0,
        marginCoveragePercent: metrics.marginCoveragePercent,
        grossMarginPercent: metrics.grossMarginPercent,
      };
    }),
  );
  const marketingActual = marketingMetrics.reduce(
    (total, metric) => ({
      spend: total.spend + Number(metric.spend),
      inquiries: total.inquiries + metric.leads,
    }),
    { spend: 0, inquiries: 0 },
  );
  const progressFactor = daysInMonth > 0 ? elapsedDays / daysInMonth : 0;
  const expectedToDate = {
    revenue: revenueTarget * progressFactor,
    spend: marketingBudgetTarget * progressFactor,
    inquiries: inquiryTarget * progressFactor,
    applications: applicationTarget * progressFactor,
    orders: (plan?.orderTarget ?? suggested.orderTarget) * progressFactor,
  };
  const pace = {
    revenue: paceStatus(actual.revenue, expectedToDate.revenue),
    inquiries: paceStatus(marketingActual.inquiries, expectedToDate.inquiries),
    applications: paceStatus(applications, expectedToDate.applications),
    orders: paceStatus(actual.orders, expectedToDate.orders),
  };
  const marketingTrackingReady =
    marketingActual.spend > 0 || marketingActual.inquiries > 0;
  const paceValues = Object.values(pace);
  const overallStatus = !marketingTrackingReady && elapsedDays > 0
    ? "data_missing"
    : paceValues.includes("behind")
      ? "behind"
      : paceValues.includes("on_track")
        ? "on_track"
        : paceValues.every((status) => status === "not_started")
          ? "not_started"
          : "ahead";
  const remainingDays = isCurrent
    ? Math.max(1, daysInMonth - localNow.getUTCDate() + 1)
    : now < period.start
      ? daysInMonth
      : 1;
  const orderTarget = plan?.orderTarget ?? suggested.orderTarget;
  const dailyFunnel = {
    daysInMonth,
    elapsedDays,
    remainingDays,
    trackingReady: marketingTrackingReady,
    overallStatus,
    targets: {
      revenueMonth: revenueTarget,
      revenueDay: revenueTarget / daysInMonth,
      spendMonth: marketingBudgetTarget,
      spendDay: marketingBudgetTarget / daysInMonth,
      inquiriesMonth: inquiryTarget,
      inquiriesDay: inquiryTarget / daysInMonth,
      applicationsMonth: applicationTarget,
      applicationsDay: applicationTarget / daysInMonth,
      ordersMonth: orderTarget,
      ordersDay: orderTarget / daysInMonth,
    },
    actual: {
      revenue: actual.revenue,
      spend: marketingActual.spend,
      inquiries: marketingActual.inquiries,
      applications,
      orders: actual.orders,
    },
    expectedToDate,
    neededPerRemainingDay: {
      revenue: Math.max(0, revenueTarget - actual.revenue) / remainingDays,
      spend: Math.max(0, marketingBudgetTarget - marketingActual.spend) / remainingDays,
      inquiries: Math.max(0, inquiryTarget - marketingActual.inquiries) / remainingDays,
      applications: Math.max(0, applicationTarget - applications) / remainingDays,
      orders: Math.max(0, orderTarget - actual.orders) / remainingDays,
    },
    pace,
    economics: {
      targetCostPerInquiry: inquiryTarget > 0
        ? marketingBudgetTarget / inquiryTarget
        : 0,
      targetCostPerApplication: applicationTarget > 0
        ? marketingBudgetTarget / applicationTarget
        : 0,
      targetCustomerAcquisitionCost: orderTarget > 0
        ? marketingBudgetTarget / orderTarget
        : 0,
      marketingSharePercent: revenueTarget > 0
        ? roundPercent((marketingBudgetTarget / revenueTarget) * 100)
        : 0,
      inquiryToApplicationPercent: inquiryTarget > 0
        ? roundPercent((applicationTarget / inquiryTarget) * 100)
        : 0,
      applicationToOrderPercent: applicationTarget > 0
        ? roundPercent((orderTarget / applicationTarget) * 100)
        : 0,
    },
  };
  return {
    month: period.key,
    role: actor.role,
    canEdit,
    plan: {
      id: plan?.id ?? null,
      revenueTarget,
      orderTarget: plan?.orderTarget ?? suggested.orderTarget,
      recommendationRevenue: Number(
        plan?.recommendationRevenue ?? suggested.revenueTarget,
      ),
      recommendationOrders: plan?.recommendationOrders ?? suggested.orderTarget,
      recommendationBasis: plan?.recommendationBasis ?? suggested.basis,
      minimumMarginPercent,
      requiredCostCoveragePercent,
      marketingBudgetTarget,
      inquiryTarget,
      applicationTarget,
      tiers: (plan?.tiers ?? []).map((tier) => ({
        id: tier.id,
        thresholdPercent: tier.thresholdPercent,
        label: tier.label,
        rewardAmount: Number(tier.rewardAmount),
      })),
    },
    actual: {
      revenue: actual.revenue,
      orders: actual.orders,
      averageOrder: actual.averageOrder,
      progressPercent,
      gap: Math.max(0, revenueTarget - actual.revenue),
      projectedRevenue,
      projectionDays: elapsedDays,
      marginCoveragePercent: actual.marginCoveragePercent,
      pricedOrders: actual.pricedOrders,
      pricedRevenue: actual.pricedRevenue,
      grossMargin: actual.grossMargin,
      grossMarginPercent: actual.grossMarginPercent,
      bonusEligible: bonusBlockers.length === 0,
      bonusBlockers,
      achievedTier: achievedTier
        ? {
            thresholdPercent: achievedTier.thresholdPercent,
            label: achievedTier.label,
            rewardAmount: Number(achievedTier.rewardAmount),
          }
        : null,
      nextTier: nextTier
        ? {
            thresholdPercent: nextTier.thresholdPercent,
            label: nextTier.label,
            rewardAmount: Number(nextTier.rewardAmount),
            remainingRevenue: Math.max(
              0,
              (revenueTarget * nextTier.thresholdPercent) / 100 - actual.revenue,
            ),
          }
        : null,
    },
    history: suggested.history,
    managers: managerProgress,
    ledger: {
      source: "Дата принятия заказа в ORDA (orderReceivedAt), без переноса из другого месяца",
      today: { date: todaySales.date, revenue: todaySales.revenue, orders: todaySales.orders },
      days: dailySales,
    },
    dailyFunnel,
  };
}

export async function updateSalesPlan(
  month: string,
  input: {
    revenueTarget: number;
    orderTarget: number;
    minimumMarginPercent: number;
    requiredCostCoveragePercent: number;
    marketingBudgetTarget: number;
    inquiryTarget: number;
    applicationTarget: number;
    tiers: Array<{ thresholdPercent: number; label: string; rewardAmount: number }>;
  },
  actor: SalesPlanActor,
) {
  if (!([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] as Role[]).includes(actor.role))
    throw new Error("FORBIDDEN");
  const period = monthRange(month);
  const existing = await ensurePlan(actor, period.year, period.month);
  if (!existing) throw new Error("NOT_FOUND");
  if (
    input.revenueTarget <= 0 ||
    input.orderTarget <= 0 ||
    !Number.isFinite(input.minimumMarginPercent) ||
    input.minimumMarginPercent < 0 ||
    input.minimumMarginPercent > 100 ||
    !Number.isFinite(input.requiredCostCoveragePercent) ||
    input.requiredCostCoveragePercent < 0 ||
    input.requiredCostCoveragePercent > 100 ||
    !Number.isFinite(input.marketingBudgetTarget) ||
    input.marketingBudgetTarget < 0 ||
    !Number.isInteger(input.inquiryTarget) ||
    input.inquiryTarget <= 0 ||
    !Number.isInteger(input.applicationTarget) ||
    input.applicationTarget <= 0 ||
    input.tiers.some(
      (tier) =>
        tier.thresholdPercent <= 0 ||
        !tier.label.trim() ||
        tier.rewardAmount < 0,
    )
  ) throw new Error("INVALID");
  await prisma.$transaction(async (tx) => {
    await tx.salesPlan.update({
      where: { id: existing.id },
      data: {
        revenueTarget: input.revenueTarget,
        orderTarget: input.orderTarget,
        minimumMarginPercent: input.minimumMarginPercent,
        requiredCostCoveragePercent: input.requiredCostCoveragePercent,
        marketingBudgetTarget: input.marketingBudgetTarget,
        inquiryTarget: input.inquiryTarget,
        applicationTarget: input.applicationTarget,
      },
    });
    await tx.salesPlanTier.deleteMany({ where: { planId: existing.id } });
    await tx.salesPlanManagerTarget.deleteMany({ where: { planId: existing.id } });
    if (input.tiers.length)
      await tx.salesPlanTier.createMany({
        data: input.tiers.map((tier, index) => ({
          planId: existing.id,
          thresholdPercent: Math.round(tier.thresholdPercent),
          label: tier.label.trim(),
          rewardAmount: tier.rewardAmount,
          position: index + 1,
        })),
      });
  });
  return getSalesPlan(month, actor);
}
