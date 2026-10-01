import { OrderLifecycle, Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type SalesPlanActor = { userId: number; role: Role };

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

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
    managerRevenue: orders.reduce((map, order) => {
      const id = order.managerUserId ?? order.leadConversion?.managerId;
      if (id) map.set(id, (map.get(id) ?? 0) + Number(order.amount));
      return map;
    }, new Map<number, number>()),
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
  const managerRevenue = new Map<number, number>();
  for (const row of history)
    for (const [managerId, amount] of row.managerRevenue)
      managerRevenue.set(managerId, (managerRevenue.get(managerId) ?? 0) + amount);
  return {
    revenueTarget,
    orderTarget,
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
    managerRevenue,
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

function splitTargets(
  managers: Array<{ id: number }>,
  recentRevenue: Map<number, number>,
  revenueTarget: number,
  orderTarget: number,
) {
  if (!managers.length) return [];
  const totalRecent = managers.reduce(
    (sum, manager) => sum + (recentRevenue.get(manager.id) ?? 0),
    0,
  );
  const equalShare = 1 / managers.length;
  const weights = managers.map((manager) => {
    const historicShare = totalRecent > 0
      ? (recentRevenue.get(manager.id) ?? 0) / totalRecent
      : equalShare;
    return 0.7 * historicShare + 0.3 * equalShare;
  });
  let revenueAssigned = 0;
  let ordersAssigned = 0;
  return managers.map((manager, index) => {
    const last = index === managers.length - 1;
    const managerRevenue = last
      ? Math.max(0, revenueTarget - revenueAssigned)
      : Math.round((revenueTarget * weights[index]) / 100_000) * 100_000;
    const managerOrders = last
      ? Math.max(0, orderTarget - ordersAssigned)
      : Math.max(1, Math.round(orderTarget * weights[index]));
    revenueAssigned += managerRevenue;
    ordersAssigned += managerOrders;
    return {
      managerId: manager.id,
      revenueTarget: managerRevenue,
      orderTarget: managerOrders,
    };
  });
}

const planInclude = {
  tiers: { orderBy: { position: "asc" as const } },
  managerTargets: {
    include: { manager: { select: { id: true, name: true, active: true } } },
    orderBy: { manager: { name: "asc" as const } },
  },
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
  const managers = await prisma.user.findMany({
    where: { companyId, active: true, role: Role.MANAGER },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const targets = splitTargets(
    managers,
    suggested.managerRevenue,
    suggested.revenueTarget,
    suggested.orderTarget,
  );
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
        createdById: actor.userId,
        tiers: {
          create: [
            { thresholdPercent: 80, label: "Рабочий темп", rewardAmount: 0, position: 1 },
            { thresholdPercent: 100, label: "План выполнен", rewardAmount: 50_000, position: 2 },
            { thresholdPercent: 110, label: "Сильный результат", rewardAmount: 100_000, position: 3 },
            { thresholdPercent: 120, label: "Рекорд месяца", rewardAmount: 150_000, position: 4 },
          ],
        },
        managerTargets: { create: targets },
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
  const [plan, actual, suggested] = await Promise.all([
    ensurePlan(actor, period.year, period.month),
    orderMetrics(period.start, period.end),
    recommendation(period.year, period.month),
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
  const canEdit = ([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] as Role[]).includes(actor.role);
  const minimumMarginPercent = Number(plan?.minimumMarginPercent ?? 25);
  const requiredCostCoveragePercent = Number(
    plan?.requiredCostCoveragePercent ?? 100,
  );
  const targets = plan?.managerTargets ?? [];
  const visibleTargets = actor.role === Role.MANAGER
    ? targets.filter((target) => target.managerId === actor.userId)
    : targets;
  const managerProgress = await Promise.all(
    visibleTargets.map(async (target) => {
      const metrics = await orderMetrics(period.start, period.end, target.managerId);
      const targetRevenue = Number(target.revenueTarget);
      const progressPercent = targetRevenue > 0
        ? Math.round((metrics.revenue / targetRevenue) * 10_000) / 100
        : 0;
      const achievedTier = plan?.tiers
        .filter((tier) => progressPercent >= tier.thresholdPercent)
        .at(-1);
      const nextTier = plan?.tiers.find((tier) => progressPercent < tier.thresholdPercent);
      const bonusBlockers = [
        ...(progressPercent < 100 ? ["Личный план продаж не выполнен"] : []),
        ...(metrics.marginCoveragePercent < requiredCostCoveragePercent
          ? [
              `Цена производства заполнена на ${metrics.marginCoveragePercent}% из ${requiredCostCoveragePercent}%`,
            ]
          : []),
        ...(metrics.grossMarginPercent < minimumMarginPercent
          ? [
              `Валовая маржа ${metrics.grossMarginPercent}% ниже ${minimumMarginPercent}%`,
            ]
          : []),
      ];
      return {
        id: target.id,
        managerId: target.managerId,
        managerName: target.manager.name,
        revenueTarget: targetRevenue,
        orderTarget: target.orderTarget,
        actualRevenue: metrics.revenue,
        actualOrders: metrics.orders,
        progressPercent,
        marginCoveragePercent: metrics.marginCoveragePercent,
        grossMarginPercent: metrics.grossMarginPercent,
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
                (targetRevenue * nextTier.thresholdPercent) / 100 - metrics.revenue,
              ),
            }
          : null,
      };
    }),
  );
  const revenueTarget = Number(plan?.revenueTarget ?? suggested.revenueTarget);
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
      progressPercent: revenueTarget > 0
        ? Math.round((actual.revenue / revenueTarget) * 10_000) / 100
        : 0,
      gap: Math.max(0, revenueTarget - actual.revenue),
      projectedRevenue,
      marginCoveragePercent: actual.marginCoveragePercent,
      pricedOrders: actual.pricedOrders,
      pricedRevenue: actual.pricedRevenue,
      grossMargin: actual.grossMargin,
      grossMarginPercent: actual.grossMarginPercent,
      bonusEligible:
        revenueTarget > 0 &&
        actual.revenue >= revenueTarget &&
        actual.marginCoveragePercent >= requiredCostCoveragePercent &&
        actual.grossMarginPercent >= minimumMarginPercent,
    },
    history: suggested.history,
    managers: managerProgress,
  };
}

export async function updateSalesPlan(
  month: string,
  input: {
    revenueTarget: number;
    orderTarget: number;
    minimumMarginPercent: number;
    requiredCostCoveragePercent: number;
    tiers: Array<{ thresholdPercent: number; label: string; rewardAmount: number }>;
    managerTargets: Array<{ managerId: number; revenueTarget: number; orderTarget: number }>;
  },
  actor: SalesPlanActor,
) {
  if (!([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] as Role[]).includes(actor.role))
    throw new Error("FORBIDDEN");
  const companyId = requireTenantIdentity().companyId;
  const period = monthRange(month);
  const existing = await ensurePlan(actor, period.year, period.month);
  if (!existing) throw new Error("NOT_FOUND");
  const managerIds = [...new Set(input.managerTargets.map((target) => target.managerId))];
  const managerCount = await prisma.user.count({
    where: { companyId, id: { in: managerIds }, active: true, role: Role.MANAGER },
  });
  if (
    input.revenueTarget <= 0 ||
    input.orderTarget <= 0 ||
    !Number.isFinite(input.minimumMarginPercent) ||
    input.minimumMarginPercent < 0 ||
    input.minimumMarginPercent > 100 ||
    !Number.isFinite(input.requiredCostCoveragePercent) ||
    input.requiredCostCoveragePercent < 0 ||
    input.requiredCostCoveragePercent > 100 ||
    managerCount !== managerIds.length ||
    input.tiers.some(
      (tier) =>
        tier.thresholdPercent <= 0 ||
        !tier.label.trim() ||
        tier.rewardAmount < 0,
    ) ||
    input.managerTargets.some(
      (target) => target.revenueTarget < 0 || target.orderTarget < 0,
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
    if (input.managerTargets.length)
      await tx.salesPlanManagerTarget.createMany({
        data: input.managerTargets.map((target) => ({
          planId: existing.id,
          managerId: target.managerId,
          revenueTarget: target.revenueTarget,
          orderTarget: Math.round(target.orderTarget),
        })),
      });
  });
  return getSalesPlan(month, actor);
}
