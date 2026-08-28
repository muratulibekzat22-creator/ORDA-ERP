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
import { buildManagerOrderAttention } from "@/lib/orders/manager-attention";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { getCompanyProfitability } from "@/lib/services/profitability.service";
import { getDirectorManagerOwnershipIssues } from "@/lib/services/manager-morning-review.service";

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

function previousDashboardRange(period: string | undefined, current: { start: Date; end: Date }) {
  if ((period ?? "month") === "month") {
    const localStart = new Date(current.start.getTime() + 5 * 60 * 60 * 1000);
    const year = localStart.getUTCFullYear();
    const month = localStart.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month - 1, 1) - 5 * 60 * 60 * 1000),
      end: new Date(Date.UTC(year, month, 1) - 5 * 60 * 60 * 1000 - 1),
    };
  }
  const duration = current.end.getTime() - current.start.getTime() + 1;
  return {
    start: new Date(current.start.getTime() - duration),
    end: new Date(current.start.getTime() - 1),
  };
}

function financialChange(current: Prisma.Decimal.Value, previous: Prisma.Decimal.Value) {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  const amount = currentValue - previousValue;
  return {
    current: currentValue,
    previous: previousValue,
    amount,
    percent: previousValue === 0 ? (currentValue === 0 ? 0 : null) : Math.round(amount / Math.abs(previousValue) * 10_000) / 100,
    direction: amount > 0 ? "UP" : amount < 0 ? "DOWN" : "SAME",
  };
}

async function salesProjection(scope: DashboardScope) {
  const companyId = requireTenantIdentity().companyId;
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
  const taskScope: Prisma.CalendarTaskWhereInput = {
    AND: [
      scope.role === Role.MANAGER ? { assigneeId: scope.userId } : { assignee: { active: true } },
      { OR: [{ orderId: null }, { order: { deletedAt: null } }, { measurement: { client: { active: true, deletedAt: null } } }] },
    ],
    status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] },
  };
  type FinanceMetricsRow = { client_balance: Prisma.Decimal; partner_balance: Prisma.Decimal; without_partner: bigint; clients_with_balance: bigint; partner_payable_orders: bigint; without_contract: bigint };
  type PayrollMetricsRow = { payable: Prisma.Decimal };
  type WorkOrderMetricsRow = { active_orders: bigint; ready_for_installation: bigint; on_installation: bigint; overdue_orders: bigint };
  const workOrderScopeSql = scope.role === Role.MANAGER
    ? Prisma.sql`AND (orders."managerUserId" = ${scope.userId} OR conversion."managerId" = ${scope.userId})`
    : Prisma.empty;
  const [leads, activeLeadsCount, overdueNextActionsCount, orders, leadEvents, orderEvents, workOrderMetricsRows, materials, taskMetrics, financeMetricsRows, measurementsToday, proposalsNeedResponse, activeUsers, payrollMetricsRows] = await Promise.all([
    prisma.client.findMany({
      where: { ...managerLeadWhere, active: true, deletedAt: null, createdAt: { gte: start, lte: end } },
      select: {
        id: true,
        name: true,
        createdAt: true,
        stage: true,
        managerUserId: true,
        manager: true,
        managerUser: { select: { name: true, active: true, role: true } },
        leadStatusHistory: { select: { toStage: true } },
        leadConversion: { select: { orderId: true, order: { select: { deletedAt: true } } } },
      },
    }),
    prisma.client.count({ where: { ...managerLeadWhere, active: true, deletedAt: null, stage: { notIn: [LeadStage.WON, LeadStage.LOST] } } }),
    prisma.leadNextAction.count({ where: { completedAt: null, nextActionAt: { lt: end }, client: { ...managerLeadWhere, active: true, deletedAt: null } } }),
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
    prisma.$queryRaw<WorkOrderMetricsRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS active_orders,
        COUNT(*) FILTER (
          WHERE orders.lifecycle = 'READY_FOR_INSTALLATION'::"OrderLifecycle"
        )::bigint AS ready_for_installation,
        COUNT(*) FILTER (
          WHERE orders.lifecycle = 'INSTALLATION'::"OrderLifecycle"
        )::bigint AS on_installation,
        COUNT(*) FILTER (
          WHERE (
            CASE
              WHEN orders.lifecycle IN (
                'READY_FOR_INSTALLATION'::"OrderLifecycle",
                'INSTALLATION'::"OrderLifecycle"
              ) THEN COALESCE(installation."scheduledAt", orders."productionDeadline")
              ELSE COALESCE(orders."productionDeadline", installation."scheduledAt")
            END
          ) < ${now}
        )::bigint AS overdue_orders
      FROM "Order" orders
      LEFT JOIN "LeadConversion" conversion ON conversion."orderId" = orders.id
      LEFT JOIN "OrderInstallation" installation ON installation."orderId" = orders.id
      WHERE orders."deletedAt" IS NULL
        AND orders."companyId" = ${companyId}
        AND orders.lifecycle NOT IN (
          'COMPLETED'::"OrderLifecycle",
          'CANCELLED'::"OrderLifecycle"
        )
        ${workOrderScopeSql}
    `),
    scope.role === Role.DIRECTOR
      ? prisma.material.findMany({ where: { active: true }, select: { stock: true, minimumStock: true } })
      : Promise.resolve([]),
    Promise.all([
      prisma.calendarTask.count({ where: { ...taskScope, dueAt: { gte: todayStart, lt: tomorrow } } }),
      prisma.calendarTask.count({ where: { ...taskScope, dueAt: { lt: now } } }),
    ]).then(([today, overdue]) => ({ today, overdue })),
    scope.role === Role.DIRECTOR
      ? prisma.$queryRaw<FinanceMetricsRow[]>`
          SELECT
            COALESCE(SUM(GREATEST("balance", 0)), 0) AS client_balance,
            COALESCE(SUM(CASE WHEN "partnerAgreedAt" IS NOT NULL THEN GREATEST("partnerBalance", 0) ELSE 0 END), 0) AS partner_balance,
            COUNT(*) FILTER (WHERE "partnerId" IS NULL)::bigint AS without_partner,
            COUNT(*) FILTER (WHERE "balance" > 0)::bigint AS clients_with_balance,
            COUNT(*) FILTER (WHERE "partnerAgreedAt" IS NOT NULL AND "partnerBalance" > 0)::bigint AS partner_payable_orders,
            COUNT(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM "Document" document
              WHERE document."orderId" = "Order".id
                AND document.type = 'CONTRACT'::"DocumentType"
                AND document.status NOT IN ('ARCHIVED'::"DocumentStatus", 'CANCELLED'::"DocumentStatus")
            ))::bigint AS without_contract
          FROM "Order"
          WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL AND lifecycle <> 'CANCELLED'::"OrderLifecycle"`
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
      ? prisma.$queryRaw<PayrollMetricsRow[]>`
          SELECT COALESCE(SUM(GREATEST(COALESCE(accrual.total, 0) - COALESCE(payment.total, 0), 0)), 0) AS payable
          FROM "EmployeePayrollProfile" employee
          LEFT JOIN (
            SELECT "employeeId", SUM(CASE WHEN direction = 'INCREASE'::"PayrollDirection" THEN amount ELSE -amount END) AS total
            FROM "PayrollAccrual" GROUP BY "employeeId"
          ) accrual ON accrual."employeeId" = employee.id
          LEFT JOIN (
            SELECT "employeeId", SUM(CASE WHEN type = 'EMPLOYEE_REFUND'::"PayrollPaymentType" THEN -amount ELSE amount END) AS total
            FROM "PayrollPayment" GROUP BY "employeeId"
          ) payment ON payment."employeeId" = employee.id
          WHERE employee."companyId" = ${companyId} AND employee.active = true AND employee."payrollEnabled" = true`
      : Promise.resolve([]),
  ]);
  const { start: monthStart } = dashboardPeriodRange("month", now);
  type ProductionMetricRow = { stage: string; count: bigint; overdue: bigint };
  const [measurementMetrics, periodProposalCount, periodPayments, monthlyExpenses, activeEmployeeCount, productionMetrics, activityPayments, activityMeasurements, activityContracts] = await Promise.all([
    Promise.all([
      prisma.measurement.count({ where: { status: { in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS] }, visitDate: { gte: tomorrow }, ...(scope.role === Role.MANAGER ? { client: managerLeadWhere } : {}) } }),
      prisma.measurement.count({ where: { status: { in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS] }, visitDate: { lt: now }, ...(scope.role === Role.MANAGER ? { client: managerLeadWhere } : {}) } }),
    ]).then(([upcoming, overdue]) => ({ upcoming, overdue })),
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
      ? prisma.$queryRaw<ProductionMetricRow[]>`
          SELECT production.stage, COUNT(*)::bigint AS count,
            COUNT(*) FILTER (WHERE production."plannedEndAt" < ${now})::bigint AS overdue
          FROM "Production" production
          JOIN "Order" orders ON orders.id = production."orderId"
          WHERE production."completedAt" IS NULL
            AND production."archivedAt" IS NULL
            AND production."companyId" = ${companyId}
            AND orders."deletedAt" IS NULL
          GROUP BY production.stage`
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
  const [measurementAttention, managerOrderRows] = scope.role === Role.MANAGER
    ? await Promise.all([prisma.leadNextAction.findMany({
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
      }), prisma.order.findMany({
        where: {
          ...managerOrderWhere,
          deletedAt: null,
          lifecycle: { not: OrderLifecycle.CANCELLED },
        },
        select: {
          id: true,
          number: true,
          lifecycle: true,
          amount: true,
          promisedAt: true,
          address: true,
          staircase: true,
          material: true,
          contractConfirmedAt: true,
          partnerId: true,
          installationCompleted: true,
          financialClosedAt: true,
          client: { select: { name: true, phone: true, city: true, address: true } },
          documents: {
            where: {
              type: DocumentType.CONTRACT,
              status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] },
            },
            orderBy: [{ documentDate: "desc" }, { id: "desc" }],
            take: 1,
            select: { status: true },
          },
          calendarTasks: {
            where: { status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] } },
            orderBy: [{ dueAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { dueAt: true },
          },
        },
        orderBy: [{ promisedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })])
    : [[], []];
  const managerOrderAttention = managerOrderRows
    .map((order) => buildManagerOrderAttention({
      id: order.id,
      number: order.number,
      lifecycle: order.lifecycle,
      amount: Number(order.amount),
      promisedAt: order.promisedAt,
      address: order.address,
      staircase: order.staircase,
      material: order.material,
      contractConfirmed: Boolean(order.contractConfirmedAt || order.documents[0]?.status === DocumentStatus.SIGNED),
      contractStatus: order.documents[0]?.status ?? null,
      partnerAssigned: Boolean(order.partnerId),
      installationCompleted: order.installationCompleted,
      financialClosedAt: order.financialClosedAt,
      nextActionAt: order.calendarTasks[0]?.dueAt ?? null,
      client: order.client,
    }, now))
    .sort((left, right) => left.priority - right.priority || Number(left.promisedAt ? new Date(left.promisedAt) : Number.POSITIVE_INFINITY) - Number(right.promisedAt ? new Date(right.promisedAt) : Number.POSITIVE_INFINITY));
  const [incompleteOrderRows, marketingContentRows, managerOwnershipIssues] = scope.role === Role.DIRECTOR
    ? await Promise.all([
        prisma.order.findMany({
          where: {
            deletedAt: null,
            lifecycle: { not: OrderLifecycle.CANCELLED },
            OR: [
              { partnerId: null },
              { partnerAgreedAt: null },
              { balance: { gt: 0 } },
            ],
          },
          select: {
            id: true,
            number: true,
            amount: true,
            balance: true,
            partnerId: true,
            partnerAgreedAt: true,
            partner: { select: { name: true } },
            client: { select: { name: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 12,
        }),
        prisma.marketingContentTask.findMany({
          select: {
            status: true,
            scheduledAt: true,
            reviewText: true,
            assignedMarketerId: true,
            contentReceivedAt: true,
            publishedAt: true,
            order: { select: { completedAt: true } },
            assets: { select: { type: true } },
          },
          take: 1000,
        }),
        getDirectorManagerOwnershipIssues(),
      ])
    : [[], [], []];
  const reached = (lead: (typeof leads)[number], stage: LeadStage) =>
    lead.stage === stage || lead.leadStatusHistory.some((item) => item.toStage === stage);
  const periodLeads = leads;
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
  const financeMetrics = financeMetricsRows[0];
  const activeBalances = {
    client: Number(financeMetrics?.client_balance ?? 0),
    partner: Number(financeMetrics?.partner_balance ?? 0),
  };
  const workOrderMetrics = workOrderMetricsRows[0];
  const technicalEvent = (value: string | null | undefined) =>
    /api-security|contract manager|\btest\b|\bdemo\b|\brbac\b|acceptance/i.test(value ?? "");
  const activities = [
    ...leadEvents.map((event) => ({ id: `lead-${event.id}`, title: event.toStatus, subject: event.client.name || event.client.phone, href: `/clients/${event.client.id}`, user: event.authorName, createdAt: event.createdAt })),
    ...orderEvents.filter((event) => !event.user || activeUserNames.has(event.user)).map((event) => ({ id: `order-${event.id}`, title: event.title, subject: event.order.number, href: `/orders/${event.order.id}`, user: event.user, createdAt: event.createdAt })),
    ...activityPayments.filter((event) => !event.author || activeUserNames.has(event.author)).map((event) => ({ id: `payment-${event.id}`, title: event.type === "PARTNER_PAYOUT" ? "Выплата партнёру" : "Платёж получен", subject: event.order?.number ?? "Финансовая операция", href: event.order ? `/orders/${event.order.id}#settlements` : "/finance", user: event.author, createdAt: event.operationDate })),
    ...activityMeasurements.filter((event) => !event.measurer || activeUserNames.has(event.measurer)).map((event) => ({ id: `measurement-${event.id}`, title: "Замер выполнен", subject: event.client.name, href: `/measurements/${event.id}`, user: event.measurer, createdAt: event.completedAt ?? now })),
    ...activityContracts.filter((event) => event.author?.active !== false).map((event) => ({ id: `contract-${event.id}`, title: "Договор сформирован", subject: event.number || event.order?.number || "Договор", href: event.order ? `/orders/${event.order.id}` : "/documents", user: event.author?.name ?? null, createdAt: event.createdAt })),
  ].filter((event) => !technicalEvent(event.title) && !technicalEvent(event.subject) && !technicalEvent(event.user)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10);
  const payrollPayable = Number(payrollMetricsRows[0]?.payable ?? 0);
  const productionCount = (stages: string[]) => productionMetrics
    .filter((row) => stages.includes(row.stage))
    .reduce((sum, row) => sum + Number(row.count), 0);
  const priorDashboardPeriod = previousDashboardRange(scope.period, { start, end });
  const profitability = scope.role === Role.DIRECTOR
    ? await getCompanyProfitability({ from: start, to: end })
    : null;
  const previousProfitability = scope.role === Role.DIRECTOR
    ? await getCompanyProfitability({ from: priorDashboardPeriod.start, to: priorDashboardPeriod.end })
    : null;
  const dashboardProfitability = profitability && previousProfitability ? {
    ...profitability,
    previousTotals: previousProfitability.totals,
    changes: {
      sales: financialChange(profitability.totals.sales, previousProfitability.totals.sales),
      grossMargin: financialChange(profitability.totals.grossMargin, previousProfitability.totals.grossMargin),
      profitBeforeMandatory: financialChange(profitability.totals.profitBeforeMandatory, previousProfitability.totals.profitBeforeMandatory),
      companyNetProfit: financialChange(profitability.totals.companyNetProfit, previousProfitability.totals.companyNetProfit),
      cashResult: financialChange(profitability.totals.cashResult, previousProfitability.totals.cashResult),
    },
  } : profitability;
  return {
    role: scope.role,
    period: { start, end },
    metrics: {
      newLeads: periodLeads.length,
      activeLeads: activeLeadsCount,
      overdueNextActions: overdueNextActionsCount,
      proposalsSent: periodProposalCount,
      measurementsScheduled: periodLeads.filter((lead) => reached(lead, LeadStage.MEASUREMENT_SCHEDULED)).length,
      orders: orders.length,
      totalSales: scope.role === Role.DIRECTOR ? Number(profitability!.totals.sales) : totals.sales,
      receivedPrepayment: scope.role === Role.DIRECTOR ? Number(profitability!.totals.clientReceived) : receivedFromClients,
      balanceToReceive: scope.role === Role.DIRECTOR ? activeBalances.client : Math.max(totals.balance, 0),
      partnerBalancePayable: scope.role === Role.DIRECTOR ? activeBalances.partner : undefined,
      ordersWithoutPartner: scope.role === Role.DIRECTOR ? Number(financeMetrics?.without_partner ?? 0) : undefined,
      payrollBalancePayable: scope.role === Role.DIRECTOR ? payrollPayable : undefined,
      conversion: percent(convertedLeads, periodLeads.length),
      activeOrders: Number(workOrderMetrics?.active_orders ?? 0),
      readyForInstallation: Number(workOrderMetrics?.ready_for_installation ?? 0),
      onInstallation: Number(workOrderMetrics?.on_installation ?? 0),
      overdueOrders: Number(workOrderMetrics?.overdue_orders ?? 0),
      lowStock: materials.filter((item) => item.stock <= item.minimumStock).length,
      tasksToday: taskMetrics.today,
      overdueTasks: taskMetrics.overdue,
      measurementsToday,
      measurementsUpcoming: measurementMetrics.upcoming,
      measurementsOverdue: measurementMetrics.overdue,
      proposalsNeedResponse,
      ordersNeedAttention: managerOrderAttention.filter((order) => order.requiresAction).length,
      ...(scope.role === Role.DIRECTOR ? {
        orderProfit: Number(profitability!.totals.orderProfit),
        grossMargin: Number(profitability!.totals.grossMargin),
        profitBeforeMandatory: Number(profitability!.totals.profitBeforeMandatory),
        companyNetProfit: Number(profitability!.totals.companyNetProfit),
        averageOrderMargin: Number(profitability!.totals.averageMargin),
        cashResult: Number(profitability!.totals.cashResult),
        incompleteProfitOrders: profitability!.totals.incompleteOrders,
        completedProfitOrders: profitability!.totals.completedOrders,
        expensesForMonth: Number(monthlyExpenses._sum.amount ?? 0),
        activeEmployees: activeEmployeeCount,
        clientsWithBalance: Number(financeMetrics?.clients_with_balance ?? 0),
        partnerPayableOrders: Number(financeMetrics?.partner_payable_orders ?? 0),
        ordersWithoutContract: Number(financeMetrics?.without_contract ?? 0),
        productionPreparation: productionCount(["Подготовка", "Каркас", "Дерево", "Комплектация"]),
        productionPainting: productionCount(["Покраска"]),
        productionReady: productionCount(["Готово к монтажу"]),
        productionOverdue: productionMetrics.reduce((sum, row) => sum + Number(row.overdue), 0),
        deliveredThisMonth: marketingContentRows.filter((task) => task.order.completedAt && task.order.completedAt >= monthStart).length,
        contentWaitingReview: marketingContentRows.filter((task) => !task.reviewText && task.status !== "REFUSED" && task.status !== "PUBLISHED").length,
        contentWaitingPhoto: marketingContentRows.filter((task) => !task.assets.some((asset) => asset.type === "PHOTO") && task.status !== "REFUSED" && task.status !== "PUBLISHED").length,
        contentWaitingVideo: marketingContentRows.filter((task) => !task.assets.some((asset) => asset.type === "VIDEO") && task.status !== "REFUSED" && task.status !== "PUBLISHED").length,
        contentShootsScheduled: marketingContentRows.filter((task) => task.status === "SHOOT_SCHEDULED").length,
        contentReceived: marketingContentRows.filter((task) => Boolean(task.contentReceivedAt)).length,
        contentPublished: marketingContentRows.filter((task) => Boolean(task.publishedAt) || task.status === "PUBLISHED").length,
        contentRefused: marketingContentRows.filter((task) => task.status === "REFUSED").length,
        contentUnassigned: marketingContentRows.filter((task) => !task.assignedMarketerId && task.status !== "REFUSED" && task.status !== "PUBLISHED").length,
      } : {}),
    },
    ...(scope.role === Role.DIRECTOR ? { managers } : {}),
    ...(dashboardProfitability ? { profitability: dashboardProfitability } : {}),
    ...(scope.role === Role.MANAGER ? { measurementAttention, managerOrderAttention } : {}),
    ...(scope.role === Role.DIRECTOR ? {
      attention: {
        managerOwnershipIssues,
        incompleteOrders: incompleteOrderRows.map((order) => ({
          id: order.id,
          number: order.number,
          client: order.client.name,
          amount: Number(order.amount),
          partnerId: order.partnerId,
          partnerName: order.partner?.name ?? null,
          missing: [
            !order.partnerId ? "цех" : null,
            !order.partnerAgreedAt ? "стоимость цеха" : null,
            Number(order.balance) > 0 ? "остаток клиента" : null,
          ].filter((item): item is string => Boolean(item)),
        })),
      },
    } : {}),
    activities,
  };
}

async function accountantProjection(scope: DashboardScope) {
  const { start, end } = dashboardPeriodRange(scope.period);
  const almaty = new Date(end.getTime() + 5 * 60 * 60 * 1000);
  const period = await prisma.payrollPeriod.findUnique({ where: { companyId_year_month: { companyId: requireTenantIdentity().companyId, year: almaty.getUTCFullYear(), month: almaty.getUTCMonth() + 1 } } });
  const [ledgerTotals, recent, accruals, payments, pendingAdvances, partnerBalances] = await Promise.all([
    prisma.companyLedgerEntry.groupBy({ by: ["direction"], where: { operationDate: { gte: start, lte: end } }, _sum: { amount: true } }),
    prisma.companyLedgerEntry.findMany({ where: { operationDate: { gte: start, lte: end } }, orderBy: { operationDate: "desc" }, take: 12, select: { id: true, type: true, category: true, direction: true, amount: true, operationDate: true, comment: true } }),
    period ? prisma.payrollAccrual.groupBy({ by: ["direction"], where: { periodId: period.id }, _sum: { amount: true } }) : Promise.resolve([]),
    period ? prisma.payrollPayment.groupBy({ by: ["type"], where: { periodId: period.id }, _sum: { amount: true } }) : Promise.resolve([]),
    period ? prisma.payrollAdvanceRequest.count({ where: { periodId: period.id, status: { in: [AdvanceRequestStatus.REQUESTED, AdvanceRequestStatus.APPROVED] } } }) : Promise.resolve(0),
    prisma.order.aggregate({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED }, partnerAgreedAt: { not: null } }, _sum: { partnerBalance: true } }),
  ]);
  const accrued = accruals.reduce((sum, row) => sum + Number(row._sum.amount ?? 0) * (row.direction === PayrollDirection.INCREASE ? 1 : -1), 0);
  const paid = payments.reduce((sum, row) => sum + Number(row._sum.amount ?? 0) * (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -1 : 1), 0);
  return {
    role: scope.role,
    period: { start, end },
    metrics: {
      receipts: Number(ledgerTotals.find((row) => row.direction === "INCOME")?._sum.amount ?? 0),
      expenses: Number(ledgerTotals.find((row) => row.direction === "EXPENSE")?._sum.amount ?? 0),
      payrollPayable: accrued - paid,
      pendingPayrollPayments: pendingAdvances,
      attentionOperations: pendingAdvances,
      partnerPayable: Math.max(Number(partnerBalances._sum.partnerBalance ?? 0), 0),
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
