import { OrderLifecycle, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type ManagerMonthlySalesRow = {
  userId: number;
  name: string;
  active: boolean;
  leads: number;
  orders: number;
  sales: number;
};

/** The same confirmed order date used by the business dashboard and reports. */
export async function getManagerMonthlySales(input: { companyId: number; start: Date; end: Date }) {
  const [users, leads, orders] = await Promise.all([
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
  return { rows, otherOrders, otherSales };
}
