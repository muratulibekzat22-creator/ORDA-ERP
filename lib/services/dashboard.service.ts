import { LeadStage, Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type DashboardScope = { role: Role; userId: number; period?: string };

const percent = (value: number, total: number) => total ? Math.round(value / total * 1000) / 10 : 0;

function periodRange(period = "month") {
  const end = new Date();
  const start = new Date(end);
  if (period === "today") start.setHours(0, 0, 0, 0);
  else if (period === "week") start.setDate(end.getDate() - 7);
  else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

export async function getDashboardSummary(scope: DashboardScope) {
  const { start, end } = periodRange(scope.period);
  const managerLeadWhere: Prisma.ClientWhereInput = scope.role === Role.MANAGER
    ? { managerUserId: scope.userId }
    : {};
  const leadWhere: Prisma.ClientWhereInput = {
    ...managerLeadWhere,
    active: true,
    createdAt: { gte: start, lte: end },
  };
  const orderWhere: Prisma.OrderWhereInput = {
    createdAt: { gte: start, lte: end },
    status: { notIn: ["Отказ / отменён", "Отменен", "Отменён"] },
    ...(scope.role === Role.MANAGER ? { leadConversion: { managerId: scope.userId } } : {}),
  };

  const [leads, orders, leadEvents, orderEvents] = await Promise.all([
    prisma.client.findMany({
      where: leadWhere,
      select: {
        id: true,
        name: true,
        stage: true,
        managerUserId: true,
        manager: true,
        managerUser: { select: { name: true } },
        leadStatusHistory: { select: { toStage: true } },
        nextActions: { where: { completedAt: null }, select: { nextActionAt: true } },
        leadConversion: { select: { orderId: true } },
      },
    }),
    prisma.order.findMany({
      where: orderWhere,
      select: { id: true, amount: true, prepayment: true, balance: true },
    }),
    prisma.leadStatusHistory.findMany({
      where: { client: managerLeadWhere, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, toStage: true, toStatus: true, authorName: true, createdAt: true, client: { select: { id: true, name: true } } },
    }),
    prisma.orderEvent.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        ...(scope.role === Role.MANAGER ? { order: { leadConversion: { managerId: scope.userId } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, user: true, createdAt: true, order: { select: { id: true, number: true } } },
    }),
  ]);

  const reached = (lead: typeof leads[number], stage: LeadStage) =>
    lead.stage === stage || lead.leadStatusHistory.some((item) => item.toStage === stage);
  const activeLeads = leads.filter((lead) => lead.stage !== LeadStage.WON && lead.stage !== LeadStage.LOST).length;
  const overdueNextActions = leads.reduce((count, lead) => count + lead.nextActions.filter((action) => action.nextActionAt < end).length, 0);
  const convertedLeads = leads.filter((lead) => lead.leadConversion).length;
  const total = orders.reduce((sum, order) => ({
    sales: sum.sales + Number(order.amount),
    prepayment: sum.prepayment + Number(order.prepayment),
    balance: sum.balance + Number(order.balance),
  }), { sales: 0, prepayment: 0, balance: 0 });

  const groups = new Map<number, { managerUserId: number; manager: string; leads: typeof leads }>();
  for (const lead of leads) {
    const id = lead.managerUserId ?? 0;
    const group = groups.get(id) ?? { managerUserId: id, manager: lead.managerUser?.name ?? lead.manager, leads: [] };
    group.leads.push(lead);
    groups.set(id, group);
  }
  const managers = [...groups.values()].map((group) => {
    const converted = group.leads.filter((lead) => lead.leadConversion).length;
    return {
      managerUserId: group.managerUserId,
      manager: group.manager,
      newLeads: group.leads.length,
      activeLeads: group.leads.filter((lead) => lead.stage !== LeadStage.WON && lead.stage !== LeadStage.LOST).length,
      proposalsSent: group.leads.filter((lead) => reached(lead, LeadStage.PROPOSAL_SENT)).length,
      measurementsScheduled: group.leads.filter((lead) => reached(lead, LeadStage.MEASUREMENT_SCHEDULED)).length,
      orders: converted,
      conversion: percent(converted, group.leads.length),
      overdueNextActions: group.leads.reduce((count, lead) => count + lead.nextActions.filter((action) => action.nextActionAt < end).length, 0),
    };
  });
  const activities = [
    ...leadEvents.map((event) => ({ id: `lead-${event.id}`, kind: "LEAD", title: event.toStatus, subject: event.client.name, href: `/clients/${event.client.id}`, user: event.authorName, createdAt: event.createdAt })),
    ...orderEvents.map((event) => ({ id: `order-${event.id}`, kind: "ORDER", title: event.title, subject: event.order.number, href: `/orders/${event.order.id}`, user: event.user, createdAt: event.createdAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10);

  return {
    period: { start, end },
    metrics: {
      newLeads: leads.length,
      activeLeads,
      overdueNextActions,
      proposalsSent: leads.filter((lead) => reached(lead, LeadStage.PROPOSAL_SENT)).length,
      measurementsScheduled: leads.filter((lead) => reached(lead, LeadStage.MEASUREMENT_SCHEDULED)).length,
      orders: orders.length,
      totalSales: total.sales,
      receivedPrepayment: total.prepayment,
      balanceToReceive: total.balance,
      conversion: percent(convertedLeads, leads.length),
    },
    managers,
    activities,
  };
}
