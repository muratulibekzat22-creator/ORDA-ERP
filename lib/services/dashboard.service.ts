import {
  AdvanceRequestStatus,
  CalendarTaskStatus,
  DocumentStatus,
  DocumentType,
  LeadStage,
  MeasurementStatus,
  OrderLifecycle,
  PayrollDirection,
  PayrollPaymentType,
  Prisma,
  Role,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

type DashboardScope = { role: Role; userId: number; period?: string };
const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 1000) / 10 : 0;

export function dashboardPeriodRange(period = "month", now = new Date()) {
  const almaty = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const year = almaty.getUTCFullYear();
  const month = almaty.getUTCMonth();
  const day = almaty.getUTCDate();
  const localStartDay = period === "today" ? day : period === "week" ? day - 6 : 1;
  return {
    start: new Date(Date.UTC(year, month, localStartDay) - 5 * 60 * 60 * 1000),
    end: now,
  };
}

async function salesProjection(scope: DashboardScope) {
  const { start, end } = dashboardPeriodRange(scope.period);
  const now = new Date();
  const { start: todayStart } = dashboardPeriodRange("today", now);
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const managerLeadWhere: Prisma.ClientWhereInput =
    scope.role === Role.MANAGER ? { managerUserId: scope.userId } : {};
  const managerOrderWhere: Prisma.OrderWhereInput =
    scope.role === Role.MANAGER
      ? { OR: [{ managerUserId: scope.userId }, { leadConversion: { managerId: scope.userId } }] }
      : {};
  const [leads, orders, leadEvents, orderEvents, workOrders, materials, tasks, activeFinanceOrders, measurementsToday, proposalsNeedResponse, activeUsers, payrollProfiles] = await Promise.all([
    prisma.client.findMany({
      where: { ...managerLeadWhere, active: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        createdAt: true,
        stage: true,
        managerUserId: true,
        manager: true,
        managerUser: { select: { name: true, active: true, role: true } },
        leadStatusHistory: { select: { toStage: true } },
        nextActions: { where: { completedAt: null }, select: { nextActionAt: true } },
        leadConversion: { select: { orderId: true, order: { select: { deletedAt: true } } } },
      },
    }),
    prisma.order.findMany({
      where: { ...managerOrderWhere, deletedAt: null, createdAt: { gte: start, lte: end }, lifecycle: { not: OrderLifecycle.CANCELLED } },
      select: { id: true, amount: true, prepayment: true, balance: true, managerUserId: true, leadConversion: { select: { managerId: true } } },
    }),
    prisma.leadStatusHistory.findMany({
      where: { client: { ...managerLeadWhere, active: true, deletedAt: null }, createdAt: { gte: start, lte: end }, OR: [{ authorId: null }, { changedBy: { active: true } }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, toStatus: true, authorName: true, createdAt: true, client: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.orderEvent.findMany({
      where: { createdAt: { gte: start, lte: end }, order: { ...managerOrderWhere, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, user: true, createdAt: true, order: { select: { id: true, number: true } } },
    }),
    prisma.order.findMany({
      where: { ...managerOrderWhere, deletedAt: null, lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] } },
      select: { lifecycle: true, productionDeadline: true, installation: { select: { scheduledAt: true } } },
    }),
    scope.role === Role.DIRECTOR
      ? prisma.material.findMany({ where: { active: true }, select: { stock: true, minimumStock: true } })
      : Promise.resolve([]),
    prisma.calendarTask.findMany({
      where: {
        AND: [
          scope.role === Role.MANAGER ? { assigneeId: scope.userId } : { assignee: { active: true } },
          { OR: [{ orderId: null }, { order: { deletedAt: null } }, { measurement: { client: { active: true, deletedAt: null } } }] },
        ],
        status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] },
      },
      select: { dueAt: true },
    }),
    scope.role === Role.DIRECTOR
      ? prisma.order.findMany({
          where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } },
          select: { id: true, balance: true, partnerId: true, partnerBalance: true, partnerAgreedAt: true, documents: { where: { type: DocumentType.CONTRACT, status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] } }, select: { id: true }, take: 1 } },
        })
      : Promise.resolve([]),
    prisma.measurement.count({
      where: {
        visitDate: { gte: todayStart, lt: tomorrow },
        status: { not: MeasurementStatus.CANCELLED },
        ...(scope.role === Role.MANAGER ? { client: managerLeadWhere } : {}),
      },
    }),
    scope.role === Role.MANAGER
      ? prisma.commercialProposal.count({
          where: {
            client: { ...managerLeadWhere, active: true, deletedAt: null },
            sentAt: { not: null },
            acceptedAt: null,
            status: { notIn: ["ACCEPTED", "REJECTED", "Принято", "Отклонено"] },
          },
        })
      : Promise.resolve(0),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true } }),
    scope.role === Role.DIRECTOR
      ? prisma.employeePayrollProfile.findMany({ where: { active: true, payrollEnabled: true }, select: { accruals: { select: { amount: true, direction: true } }, payments: { select: { amount: true, type: true } } } })
      : Promise.resolve([]),
  ]);
  const { start: monthStart } = dashboardPeriodRange("month", now);
  const [measurementQueue, periodProposalCount, periodPayments, monthlyExpenses, activeEmployeeCount, productionJobs, activityPayments, activityMeasurements, activityContracts] = await Promise.all([
    prisma.measurement.findMany({
      where: {
        status: { in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS] },
        ...(scope.role === Role.MANAGER ? { client: managerLeadWhere } : {}),
      },
      select: { visitDate: true, status: true },
    }),
    prisma.commercialProposal.count({
      where: {
        client: { ...managerLeadWhere, active: true, deletedAt: null },
        sentAt: { gte: start, lte: end },
      },
    }),
    prisma.payment.groupBy({
      by: ["type"],
      where: {
        operationDate: { gte: start, lte: end },
        type: { in: ["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT", "REFUND"] },
        order: { ...managerOrderWhere, deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } },
      },
      _sum: { amount: true },
    }),
    scope.role === Role.DIRECTOR
      ? prisma.companyLedgerEntry.aggregate({ where: { direction: "EXPENSE", operationDate: { gte: monthStart, lte: now } }, _sum: { amount: true } })
      : Promise.resolve({ _sum: { amount: null } }),
    scope.role === Role.DIRECTOR
      ? prisma.employeePayrollProfile.count({ where: { active: true } })
      : Promise.resolve(0),
    scope.role === Role.DIRECTOR
      ? prisma.production.findMany({ where: { completedAt: null, archivedAt: null, order: { deletedAt: null } }, select: { stage: true, plannedEndAt: true } })
      : Promise.resolve([]),
    scope.role === Role.DIRECTOR
      ? prisma.payment.findMany({
          where: { operationDate: { gte: start, lte: end }, type: { in: ["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT", "PARTNER_PAYOUT"] }, order: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } } },
          orderBy: { operationDate: "desc" },
          take: 10,
          select: { id: true, type: true, author: true, operationDate: true, order: { select: { id: true, number: true } } },
        })
      : Promise.resolve([]),
    scope.role === Role.DIRECTOR
      ? prisma.measurement.findMany({
          where: { completedAt: { gte: start, lte: end }, status: { in: [MeasurementStatus.COMPLETED, MeasurementStatus.HANDED_TO_MANAGER] } },
          orderBy: { completedAt: "desc" },
          take: 10,
          select: { id: true, completedAt: true, measurer: true, client: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    scope.role === Role.DIRECTOR
      ? prisma.document.findMany({
          where: { type: DocumentType.CONTRACT, createdAt: { gte: start, lte: end }, status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] }, OR: [{ orderId: null }, { order: { deletedAt: null } }] },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, number: true, createdAt: true, author: { select: { name: true, active: true } }, order: { select: { id: true, number: true } } },
        })
      : Promise.resolve([]),
  ]);
  const measurementAttention = scope.role === Role.MANAGER
    ? await prisma.leadNextAction.findMany({
        where: {
          completedAt: null,
          nextActionComment: { contains: "Замер №", mode: "insensitive" },
          client: {
            managerUserId: scope.userId,
            active: true,
            deletedAt: null,
          },
        },
        orderBy: { nextActionAt: "asc" },
        take: 12,
        select: {
          id: true,
          nextActionAt: true,
          nextActionComment: true,
          client: { select: { id: true, name: true, phone: true } },
        },
      })
    : [];
  const reached = (lead: (typeof leads)[number], stage: LeadStage) =>
    lead.stage === stage || lead.leadStatusHistory.some((item) => item.toStage === stage);
  const periodLeads = leads.filter((lead) => lead.createdAt >= start && lead.createdAt <= end);
  const convertedLeads = periodLeads.filter((lead) => lead.leadConversion && !lead.leadConversion.order.deletedAt).length;
  const totals = orders.reduce(
    (sum, order) => ({ sales: sum.sales + Number(order.amount), received: sum.received + Number(order.prepayment), balance: sum.balance + Number(order.balance) }),
    { sales: 0, received: 0, balance: 0 },
  );
  const receivedFromClients = periodPayments.reduce((sum, row) => {
    const amount = Number(row._sum.amount ?? 0);
    return sum + (row.type === "REFUND" ? -amount : amount);
  }, 0);
  const managerGroups = new Map<number, { managerUserId: number; manager: string; leads: typeof leads }>();
  for (const manager of activeUsers.filter((user) => user.role === Role.MANAGER))
    managerGroups.set(manager.id, { managerUserId: manager.id, manager: manager.name, leads: [] });
  for (const lead of periodLeads) {
    const id = lead.managerUserId ?? 0;
    const group = managerGroups.get(id) ?? { managerUserId: id, manager: lead.managerUser?.name ?? lead.manager, leads: [] };
    group.leads.push(lead);
    managerGroups.set(id, group);
  }
  const activeManagerIds = new Set(activeUsers.filter((user) => user.role === Role.MANAGER).map((user) => user.id));
  const activeUserNames = new Set(activeUsers.map((user) => user.name));
  const managers = [...managerGroups.values()].filter((group) => activeManagerIds.has(group.managerUserId)).map((group) => {
    const converted = group.leads.filter((lead) => lead.leadConversion && !lead.leadConversion.order.deletedAt).length;
    const managerOrders = orders.filter((order) => (order.managerUserId ?? order.leadConversion?.managerId) === group.managerUserId);
    return {
      managerUserId: group.managerUserId,
      manager: group.manager,
      newLeads: group.leads.length,
      measurementsScheduled: group.leads.filter((lead) => reached(lead, LeadStage.MEASUREMENT_SCHEDULED)).length,
      orders: managerOrders.length,
      totalSales: managerOrders.reduce((sum, order) => sum + Number(order.amount), 0),
      conversion: percent(converted, group.leads.length),
    };
  });
  const activeBalances = activeFinanceOrders.reduce(
    (sum, order) => ({
      client: sum.client + Math.max(Number(order.balance), 0),
      partner: sum.partner + (order.partnerAgreedAt ? Math.max(Number(order.partnerBalance), 0) : 0),
    }),
    { client: 0, partner: 0 },
  );
  const deadline = (order: (typeof workOrders)[number]) =>
    order.lifecycle === OrderLifecycle.READY_FOR_INSTALLATION || order.lifecycle === OrderLifecycle.INSTALLATION
      ? order.installation?.scheduledAt ?? order.productionDeadline
      : order.productionDeadline ?? order.installation?.scheduledAt;
  const technicalEvent = (value: string | null | undefined) =>
    /api-security|contract manager|\btest\b|\bdemo\b|\brbac\b|acceptance/i.test(value ?? "");
  const activities = [
    ...leadEvents.map((event) => ({ id: `lead-${event.id}`, title: event.toStatus, subject: event.client.name || event.client.phone, href: `/clients/${event.client.id}`, user: event.authorName, createdAt: event.createdAt })),
    ...orderEvents.filter((event) => !event.user || activeUserNames.has(event.user)).map((event) => ({ id: `order-${event.id}`, title: event.title, subject: event.order.number, href: `/orders/${event.order.id}`, user: event.user, createdAt: event.createdAt })),
    ...activityPayments.filter((event) => !event.author || activeUserNames.has(event.author)).map((event) => ({ id: `payment-${event.id}`, title: event.type === "PARTNER_PAYOUT" ? "Выплата партнёру" : "Платёж получен", subject: event.order?.number ?? "Финансовая операция", href: event.order ? `/orders/${event.order.id}#settlements` : "/finance", user: event.author, createdAt: event.operationDate })),
    ...activityMeasurements.filter((event) => !event.measurer || activeUserNames.has(event.measurer)).map((event) => ({ id: `measurement-${event.id}`, title: "Замер выполнен", subject: event.client.name, href: `/measurements/${event.id}`, user: event.measurer, createdAt: event.completedAt ?? now })),
    ...activityContracts.filter((event) => event.author?.active !== false).map((event) => ({ id: `contract-${event.id}`, title: "Договор сформирован", subject: event.number || event.order?.number || "Договор", href: event.order ? `/orders/${event.order.id}` : "/documents", user: event.author?.name ?? null, createdAt: event.createdAt })),
  ].filter((event) => !technicalEvent(event.title) && !technicalEvent(event.subject) && !technicalEvent(event.user)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10);
  const payrollPayable = payrollProfiles.reduce((total, profile) => {
    const accrued = profile.accruals.reduce((sum, row) => sum + Number(row.amount) * (row.direction === PayrollDirection.INCREASE ? 1 : -1), 0);
    const paid = profile.payments.reduce((sum, row) => sum + Number(row.amount) * (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -1 : 1), 0);
    return total + Math.max(accrued - paid, 0);
  }, 0);
  return {
    role: scope.role,
    period: { start, end },
    metrics: {
      newLeads: periodLeads.length,
      activeLeads: leads.filter((lead) => lead.stage !== LeadStage.WON && lead.stage !== LeadStage.LOST).length,
      overdueNextActions: leads.reduce((count, lead) => count + lead.nextActions.filter((action) => action.nextActionAt < end).length, 0),
      proposalsSent: periodProposalCount,
      measurementsScheduled: periodLeads.filter((lead) => reached(lead, LeadStage.MEASUREMENT_SCHEDULED)).length,
      orders: orders.length,
      totalSales: totals.sales,
      receivedPrepayment: receivedFromClients,
      balanceToReceive: scope.role === Role.DIRECTOR ? activeBalances.client : Math.max(totals.balance, 0),
      partnerBalancePayable: scope.role === Role.DIRECTOR ? activeBalances.partner : undefined,
      ordersWithoutPartner: scope.role === Role.DIRECTOR ? activeFinanceOrders.filter((order) => !order.partnerId).length : undefined,
      payrollBalancePayable: scope.role === Role.DIRECTOR ? payrollPayable : undefined,
      conversion: percent(convertedLeads, periodLeads.length),
      activeOrders: workOrders.length,
      readyForInstallation: workOrders.filter((order) => order.lifecycle === OrderLifecycle.READY_FOR_INSTALLATION).length,
      onInstallation: workOrders.filter((order) => order.lifecycle === OrderLifecycle.INSTALLATION).length,
      overdueOrders: workOrders.filter((order) => { const value = deadline(order); return Boolean(value && value < now); }).length,
      lowStock: materials.filter((item) => item.stock <= item.minimumStock).length,
      tasksToday: tasks.filter((task) => task.dueAt >= todayStart && task.dueAt < tomorrow).length,
      overdueTasks: tasks.filter((task) => task.dueAt < now).length,
      measurementsToday,
      measurementsUpcoming: measurementQueue.filter((item) => item.visitDate >= tomorrow).length,
      measurementsOverdue: measurementQueue.filter((item) => item.visitDate < now).length,
      proposalsNeedResponse,
      ...(scope.role === Role.DIRECTOR ? {
        expensesForMonth: Number(monthlyExpenses._sum.amount ?? 0),
        activeEmployees: activeEmployeeCount,
        clientsWithBalance: activeFinanceOrders.filter((order) => Number(order.balance) > 0).length,
        partnerPayableOrders: activeFinanceOrders.filter((order) => order.partnerAgreedAt && Number(order.partnerBalance) > 0).length,
        ordersWithoutContract: activeFinanceOrders.filter((order) => order.documents.length === 0).length,
        productionPreparation: productionJobs.filter((job) => ["Подготовка", "Каркас", "Дерево", "Комплектация"].includes(job.stage)).length,
        productionPainting: productionJobs.filter((job) => job.stage === "Покраска").length,
        productionReady: productionJobs.filter((job) => job.stage === "Готово к монтажу").length,
        productionOverdue: productionJobs.filter((job) => Boolean(job.plannedEndAt && job.plannedEndAt < now)).length,
      } : {}),
    },
    ...(scope.role === Role.DIRECTOR ? { managers } : {}),
    ...(scope.role === Role.MANAGER ? { measurementAttention } : {}),
    activities,
  };
}

async function accountantProjection(scope: DashboardScope) {
  const { start, end } = dashboardPeriodRange(scope.period);
  const almaty = new Date(end.getTime() + 5 * 60 * 60 * 1000);
  const period = await prisma.payrollPeriod.findUnique({ where: { year_month: { year: almaty.getUTCFullYear(), month: almaty.getUTCMonth() + 1 } } });
  const [ledger, recent, accruals, payments, pendingAdvances, partnerBalances] = await Promise.all([
    prisma.companyLedgerEntry.findMany({ where: { operationDate: { gte: start, lte: end } }, select: { direction: true, amount: true } }),
    prisma.companyLedgerEntry.findMany({ where: { operationDate: { gte: start, lte: end } }, orderBy: { operationDate: "desc" }, take: 12, select: { id: true, type: true, category: true, direction: true, amount: true, operationDate: true, comment: true } }),
    period ? prisma.payrollAccrual.findMany({ where: { periodId: period.id }, select: { amount: true, direction: true } }) : Promise.resolve([]),
    period ? prisma.payrollPayment.findMany({ where: { periodId: period.id }, select: { amount: true, type: true } }) : Promise.resolve([]),
    period ? prisma.payrollAdvanceRequest.count({ where: { periodId: period.id, status: { in: [AdvanceRequestStatus.REQUESTED, AdvanceRequestStatus.APPROVED] } } }) : Promise.resolve(0),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED }, partnerAgreedAt: { not: null } }, select: { partnerBalance: true } }),
  ]);
  const accrued = accruals.reduce((sum, row) => sum + Number(row.amount) * (row.direction === PayrollDirection.INCREASE ? 1 : -1), 0);
  const paid = payments.reduce((sum, row) => sum + Number(row.amount) * (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -1 : 1), 0);
  return {
    role: scope.role,
    period: { start, end },
    metrics: {
      receipts: ledger.filter((row) => row.direction === "INCOME").reduce((sum, row) => sum + Number(row.amount), 0),
      expenses: ledger.filter((row) => row.direction === "EXPENSE").reduce((sum, row) => sum + Number(row.amount), 0),
      payrollPayable: accrued - paid,
      pendingPayrollPayments: pendingAdvances,
      attentionOperations: pendingAdvances,
      partnerPayable: partnerBalances.reduce((sum, order) => sum + Math.max(Number(order.partnerBalance), 0), 0),
    },
    recentFinance: recent,
  };
}

async function productionProjection(scope: DashboardScope) {
  const now = new Date();
  const { start: todayStart } = dashboardPeriodRange("today", now);
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const [jobs, materials, tasksToday] = await Promise.all([
    prisma.production.findMany({
      where: { completedAt: null, archivedAt: null, order: { deletedAt: null }, OR: [{ masterUserId: scope.userId }, { masterUserId: null }] },
      orderBy: [{ priority: "desc" }, { plannedEndAt: "asc" }],
      take: 30,
      select: { id: true, stage: true, percent: true, priority: true, plannedEndAt: true, masterUserId: true, order: { select: { id: true, number: true, client: { select: { name: true, city: true } } } } },
    }),
    prisma.material.findMany({ where: { active: true }, select: { stock: true, minimumStock: true } }),
    prisma.calendarTask.count({ where: { assigneeId: scope.userId, dueAt: { gte: todayStart, lt: tomorrow }, status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] } } }),
  ]);
  const preparationStages = ["Подготовка", "Каркас", "Дерево", "Комплектация"];
  return {
    role: scope.role,
    metrics: {
      preparation: jobs.filter((job) => preparationStages.includes(job.stage)).length,
      painting: jobs.filter((job) => job.stage === "Покраска").length,
      readyForInstallation: jobs.filter((job) => job.stage === "Готово к монтажу").length,
      overdue: jobs.filter((job) => Boolean(job.plannedEndAt && job.plannedEndAt < now)).length,
      availableTasks: jobs.length,
      missingMaterials: materials.filter((item) => item.stock <= item.minimumStock).length,
      readyMaterials: materials.filter((item) => item.stock > item.minimumStock).length,
      tasksToday,
      attentionOrders: jobs.filter((job) => job.priority > 0 || Boolean(job.plannedEndAt && job.plannedEndAt < now)).length,
    },
    jobs: jobs.map((job) => ({ ...job, href: `/orders/${job.order.id}` })),
  };
}

async function installerProjection(scope: DashboardScope) {
  const now = new Date();
  const { start: todayStart } = dashboardPeriodRange("today", now);
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);
  const installations = await prisma.orderInstallation.findMany({
    where: { installerUserId: scope.userId, completedAt: null, order: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } } },
    orderBy: { scheduledAt: "asc" },
    take: 30,
    select: { id: true, scheduledAt: true, startedAt: true, order: { select: { id: true, number: true, address: true, client: { select: { name: true, city: true } } } } },
  });
  return {
    role: scope.role,
    metrics: {
      today: installations.filter((item) => item.scheduledAt >= todayStart && item.scheduledAt < tomorrow).length,
      upcoming: installations.filter((item) => item.scheduledAt >= tomorrow).length,
      overdue: installations.filter((item) => item.scheduledAt < todayStart).length,
      assigned: installations.length,
    },
    nextInstallation: installations[0] ? { ...installations[0], href: `/orders/${installations[0].order.id}` } : null,
    installations: installations.map((item) => ({ ...item, href: `/orders/${item.order.id}` })),
  };
}

export async function getDashboardSummary(scope: DashboardScope) {
  if (scope.role === Role.DIRECTOR || scope.role === Role.MANAGER) return salesProjection(scope);
  if (scope.role === Role.ACCOUNTANT) return accountantProjection(scope);
  if (scope.role === Role.PRODUCTION) return productionProjection(scope);
  if (scope.role === Role.INSTALLER) return installerProjection(scope);
  throw new Error("DASHBOARD_ROLE_FORBIDDEN");
}
