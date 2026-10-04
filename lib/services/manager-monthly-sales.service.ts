import { OrderLifecycle, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type ManagerMonthlySalesRow = {
  userId: number;
  name: string;
  active: boolean;
  leads: number;
  orders: number;
  sales: number;
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
      select: { id: true, name: true, active: true, payrollProfile: { select: { position: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.client.groupBy({
      by: ["managerUserId"],
      where: { companyId: input.companyId, active: true, deletedAt: null, createdAt: { gte: input.start, lt: input.end }, managerUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        lifecycle: { not: OrderLifecycle.CANCELLED },
        orderDateNeedsReview: false,
        orderReceivedAt: { gte: input.start, lt: input.end },
      },
      select: { managerUserId: true, manager: true, amount: true },
    }),
    prisma.salesPlan.findUnique({
      where: { companyId_year_month: { companyId: input.companyId, year: localStart.getUTCFullYear(), month: localStart.getUTCMonth() + 1 } },
      select: { managerTargets: { select: { managerId: true, revenueTarget: true, orderTarget: true } } },
    }),
  ]);
  const rows: ManagerMonthlySalesRow[] = users
    .filter((user) => !/замер/i.test(user.payrollProfile?.position ?? ""))
    .map((user) => ({
      userId: user.id,
      name: user.name,
      active: user.active,
      leads: leads.find((lead) => lead.managerUserId === user.id)?._count._all ?? 0,
      orders: 0,
      sales: 0,
      planOrders: plan?.managerTargets.find((target) => target.managerId === user.id)?.orderTarget ?? null,
      planSales: Number(plan?.managerTargets.find((target) => target.managerId === user.id)?.revenueTarget ?? 0) || null,
      completionPercent: null,
    }));
  const byId = new Map(rows.map((row) => [row.userId, row]));
  const byName = new Map(rows.map((row) => [row.name.trim().toLocaleLowerCase("ru"), row]));
  let otherOrders = 0;
  let otherSales = 0;
  for (const order of orders) {
    const row = (order.managerUserId ? byId.get(order.managerUserId) : undefined)
      ?? (!order.managerUserId ? byName.get(order.manager.trim().toLocaleLowerCase("ru")) : undefined);
    if (row) {
      row.orders += 1;
      row.sales += Number(order.amount);
    } else {
      otherOrders += 1;
      otherSales += Number(order.amount);
    }
  }
  for (const row of rows) {
    row.completionPercent = row.planSales && row.planSales > 0
      ? Math.round((row.sales / row.planSales) * 10_000) / 100
      : null;
  }
  return { rows, otherOrders, otherSales };
}
