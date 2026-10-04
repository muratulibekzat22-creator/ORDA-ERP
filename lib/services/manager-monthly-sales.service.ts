import { OrderLifecycle, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hasProductionPrice } from "@/lib/orders/production-price";
import { loadOwnershipChanges, ownerAt } from "@/lib/services/handover-attribution";

export type ManagerMonthlySalesRow = {
  userId: number;
  name: string;
  active: boolean;
  leads: number;
  orders: number;
  sales: number;
  pricedOrders: number;
  pricedRevenue: number;
  productionCost: number;
  marginCoveragePercent: number;
  grossMarginPercent: number;
  planOrders: number | null;
  planSales: number | null;
  completionPercent: number | null;
};

/** The same confirmed order date used by the business dashboard and reports. */
export async function getManagerMonthlySales(input: { companyId: number; start: Date; end: Date }) {
  const localStart = new Date(input.start.getTime() + 5 * 60 * 60 * 1000);
  const [users, leads, orders, plan] = await Promise.all([
    prisma.user.findMany({
      where: { companyId: input.companyId, role: Role.MANAGER },
      select: { id: true, name: true, active: true, payrollProfile: { select: { position: true, hiredAt: true, terminatedAt: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({
      where: { companyId: input.companyId, active: true, deletedAt: null, createdAt: { gte: input.start, lt: input.end }, managerUserId: { not: null } },
      select: { id: true, managerUserId: true, createdAt: true },
    }),
    prisma.order.findMany({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        lifecycle: { not: OrderLifecycle.CANCELLED },
        orderDateNeedsReview: false,
        orderReceivedAt: { gte: input.start, lt: input.end },
      },
      select: { id: true, managerUserId: true, manager: true, amount: true, partnerPrice: true, partnerAgreedAt: true, orderReceivedAt: true },
    }),
    prisma.salesPlan.findUnique({
      where: { companyId_year_month: { companyId: input.companyId, year: localStart.getUTCFullYear(), month: localStart.getUTCMonth() + 1 } },
      select: { managerTargets: { select: { managerId: true, revenueTarget: true, orderTarget: true } } },
    }),
  ]);
  const [leadChanges, orderChanges] = await Promise.all([
    loadOwnershipChanges(input.companyId, "clients", leads.map((lead) => lead.id)),
    loadOwnershipChanges(input.companyId, "orders", orders.map((order) => order.id)),
  ]);
  const rows: ManagerMonthlySalesRow[] = users
    .filter((user) => !/замер/i.test(user.payrollProfile?.position ?? ""))
    .map((user) => ({
      userId: user.id,
      name: user.name,
      active: user.active,
      leads: leads.filter((lead) => ownerAt(lead.managerUserId, lead.createdAt, leadChanges.get(lead.id)) === user.id).length,
      orders: 0,
      sales: 0,
      pricedOrders: 0,
      pricedRevenue: 0,
      productionCost: 0,
      marginCoveragePercent: 0,
      grossMarginPercent: 0,
      planOrders: plan?.managerTargets.find((target) => target.managerId === user.id)?.orderTarget ?? null,
      planSales: Number(plan?.managerTargets.find((target) => target.managerId === user.id)?.revenueTarget ?? 0) || null,
      completionPercent: null,
    }));
  const byId = new Map(rows.map((row) => [row.userId, row]));
  const byName = new Map(rows.map((row) => [row.name.trim().toLocaleLowerCase("ru"), row]));
  let otherOrders = 0;
  let otherSales = 0;
  for (const order of orders) {
    const historicalOwner = ownerAt(order.managerUserId, order.orderReceivedAt, orderChanges.get(order.id));
    const row = (historicalOwner ? byId.get(historicalOwner) : undefined)
      ?? (!order.managerUserId ? byName.get(order.manager.trim().toLocaleLowerCase("ru")) : undefined);
    if (row) {
      row.orders += 1;
      row.sales += Number(order.amount);
      if (hasProductionPrice(order.partnerPrice, order.partnerAgreedAt)) {
        row.pricedOrders += 1;
        row.pricedRevenue += Number(order.amount);
        row.productionCost += Number(order.partnerPrice);
      }
    } else {
      otherOrders += 1;
      otherSales += Number(order.amount);
    }
  }
  for (const row of rows) {
    row.marginCoveragePercent = row.orders > 0 ? Math.round((row.pricedOrders / row.orders) * 10_000) / 100 : 100;
    row.grossMarginPercent = row.pricedRevenue > 0 ? Math.round(((row.pricedRevenue - row.productionCost) / row.pricedRevenue) * 10_000) / 100 : 0;
    row.completionPercent = row.planSales && row.planSales > 0
      ? Math.round((row.sales / row.planSales) * 10_000) / 100
      : null;
  }
  return {
    rows: rows.filter((row) => {
      const profile = users.find((user) => user.id === row.userId)?.payrollProfile;
      const workedInPeriod = Boolean(profile && profile.hiredAt < input.end && (!profile.terminatedAt || profile.terminatedAt >= input.start));
      return row.active || workedInPeriod || row.orders > 0 || row.leads > 0;
    }),
    otherOrders,
    otherSales,
  };
}
