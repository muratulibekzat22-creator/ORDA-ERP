import { CalendarTaskStatus, CalendarTaskWorkflow, Prisma, Role } from "@prisma/client";

import { orderDataGaps } from "@/lib/orders/completeness";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;
const ACTIVE_TASK_STATUSES = [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] as const;

function dateKeyAtAlmaty(value: Date) {
  const local = new Date(value.getTime() + ALMATY_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function addDays(key: string, days: number) {
  const local = new Date(`${key}T00:00:00+05:00`);
  return dateKeyAtAlmaty(new Date(local.getTime() + days * 86_400_000));
}

function dayRange(key: string) {
  const start = new Date(`${key}T00:00:00+05:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function dueAtForBusinessDate(key: string) {
  return new Date(`${key}T10:00:00+05:00`);
}

function formatDate(key: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "long" }).format(new Date(`${key}T12:00:00+05:00`));
}

export type DailyCrmRow = {
  managerId: number;
  manager: string;
  leadsReceived: number;
  contacted: number;
  interested: number;
  measurementsScheduled: number;
  measurementsCompleted: number;
  ordersCreated: number;
  revenue: number;
  reportStatus: "NOT_SENT" | "ACKNOWLEDGED" | "SENT";
  reportTaskId: number | null;
  reportSubmittedAt: Date | null;
};

export async function getDailyCrmSnapshot(input: { dateKey?: string; managerId?: number; now?: Date } = {}) {
  const { companyId } = requireTenantIdentity();
  const todayKey = dateKeyAtAlmaty(input.now ?? new Date());
  const dateKey = input.dateKey ?? addDays(todayKey, -1);
  const { start, end } = dayRange(dateKey);
  const managerWhere: Prisma.UserWhereInput = {
    companyId,
    active: true,
    role: Role.MANAGER,
    ...(input.managerId ? { id: input.managerId } : {}),
  };
  const managers = await prisma.user.findMany({ where: managerWhere, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const ids = managers.map((manager) => manager.id);
  if (!ids.length) return { dateKey, dateLabel: formatDate(dateKey), totals: emptyTotals(), managers: [] as DailyCrmRow[] };
  const [leads, interactions, qualifiedEvents, measurements, orders, reportTasks] = await Promise.all([
    prisma.client.findMany({
      where: { companyId, deletedAt: null, managerUserId: { in: ids }, createdAt: { gte: start, lt: end } },
      select: { id: true, managerUserId: true },
    }),
    prisma.clientInteraction.findMany({
      where: { client: { companyId, deletedAt: null, managerUserId: { in: ids } }, createdAt: { gte: start, lt: end } },
      select: { clientId: true, client: { select: { managerUserId: true } } },
    }),
    prisma.leadStatusHistory.findMany({
      where: {
        client: { companyId, deletedAt: null, managerUserId: { in: ids } },
        createdAt: { gte: start, lt: end },
        toStage: { notIn: ["NEW", "LOST"] },
      },
      select: { clientId: true, client: { select: { managerUserId: true } } },
    }),
    prisma.measurement.findMany({
      where: {
        companyId,
        OR: [{ createdAt: { gte: start, lt: end } }, { completedAt: { gte: start, lt: end } }],
        client: { managerUserId: { in: ids } },
      },
      select: { id: true, createdAt: true, completedAt: true, client: { select: { managerUserId: true } } },
    }),
    prisma.order.findMany({
      where: { companyId, deletedAt: null, lifecycle: { not: "CANCELLED" }, managerUserId: { in: ids }, orderReceivedAt: { gte: start, lt: end } },
      select: { managerUserId: true, amount: true },
    }),
    prisma.calendarTask.findMany({
      where: { companyId, assigneeId: { in: ids }, workflow: CalendarTaskWorkflow.DAILY_CRM_REPORT, workflowKey: { startsWith: `daily-crm:${dateKey}:` } },
      select: { id: true, assigneeId: true, acknowledgedAt: true, resultSubmittedAt: true },
    }),
  ]);
  const uniqueCount = (items: Array<{ clientId: number; client: { managerUserId: number | null } }>, managerId: number) =>
    new Set(items.filter((item) => item.client.managerUserId === managerId).map((item) => item.clientId)).size;
  const rows: DailyCrmRow[] = managers.map((manager) => {
    const task = reportTasks.find((item) => item.assigneeId === manager.id);
    const managerOrders = orders.filter((order) => order.managerUserId === manager.id);
    return {
      managerId: manager.id,
      manager: manager.name,
      leadsReceived: leads.filter((lead) => lead.managerUserId === manager.id).length,
      contacted: uniqueCount(interactions, manager.id),
      interested: uniqueCount(qualifiedEvents, manager.id),
      measurementsScheduled: measurements.filter((measurement) => measurement.client.managerUserId === manager.id && measurement.createdAt >= start && measurement.createdAt < end).length,
      measurementsCompleted: measurements.filter((measurement) => measurement.client.managerUserId === manager.id && measurement.completedAt && measurement.completedAt >= start && measurement.completedAt < end).length,
      ordersCreated: managerOrders.length,
      revenue: managerOrders.reduce((sum, order) => sum + Number(order.amount), 0),
      reportStatus: task?.resultSubmittedAt ? "SENT" : task?.acknowledgedAt ? "ACKNOWLEDGED" : "NOT_SENT",
      reportTaskId: task?.id ?? null,
      reportSubmittedAt: task?.resultSubmittedAt ?? null,
    };
  });
  return {
    dateKey,
    dateLabel: formatDate(dateKey),
    totals: rows.reduce((total, row) => ({
      leadsReceived: total.leadsReceived + row.leadsReceived,
      contacted: total.contacted + row.contacted,
      interested: total.interested + row.interested,
      measurementsScheduled: total.measurementsScheduled + row.measurementsScheduled,
      measurementsCompleted: total.measurementsCompleted + row.measurementsCompleted,
      ordersCreated: total.ordersCreated + row.ordersCreated,
      revenue: total.revenue + row.revenue,
    }), emptyTotals()),
    managers: rows,
  };
}

function emptyTotals() {
  return { leadsReceived: 0, contacted: 0, interested: 0, measurementsScheduled: 0, measurementsCompleted: 0, ordersCreated: 0, revenue: 0 };
}

function dailyReportDescription(row: DailyCrmRow, dateKey: string) {
  return [
    `Ежедневный CRM-отчёт за ${formatDate(dateKey)}. ORDA посчитала фактические действия автоматически:`,
    "",
    `• поступило заявок: ${row.leadsReceived}`,
    `• клиентов с записанным контактом: ${row.contacted}`,
    `• квалифицировано / заинтересовано: ${row.interested}`,
    `• назначено замеров: ${row.measurementsScheduled}`,
    `• завершено замеров: ${row.measurementsCompleted}`,
    `• оформлено заказов: ${row.ordersCreated}`,
    `• сумма оформленных заказов: ${row.revenue.toLocaleString("ru-RU")} ₸`,
    "",
    "Проверьте каждую заявку за этот день: указан источник, стадия, качество лида, результат разговора и следующее действие с датой. Если показатель выглядит неверно, исправьте карточки клиентов, а не цифру отчёта.",
    "",
    "В результате коротко напишите: сколько заявок реально обработано, причины необработанных заявок и что будет сделано сегодня.",
  ].join("\n");
}

function orientationDescription() {
  return [
    "Сегодня необходимо пройти краткое ознакомление с рабочим порядком ORDA.",
    "",
    "1. Заявка: заполнить имя, телефон, город, источник, ответственного, стадию, итог контакта и следующее действие с датой.",
    "2. Замер: проверить клиента по номеру телефона, указать город, адрес, дату, назначенного замерщика либо «Замерщик не выбран», затем записать результат.",
    "3. Заказ: проверить договорную сумму, фактически полученную оплату, остаток, срок, цех и подтверждённую цену производства.",
    "4. Доплата: если клиент обещал доплатить позже, указать сумму и дату; после напоминания записать фактический результат.",
    "5. Каждый день: открыть блок «Требуют внимания», исправить свои карточки и отправить CRM-отчёт за предыдущий день.",
    "",
    "Подтвердите ознакомление. В результате перечислите разделы, которые проверили, и вопросы, если они остались.",
  ].join("\n");
}

export async function ensureDailyManagerOperations(founderId: number, now = new Date()) {
  const { companyId } = requireTenantIdentity();
  const todayKey = dateKeyAtAlmaty(now);
  const reportDateKey = addDays(todayKey, -1);
  const dueAt = dueAtForBusinessDate(todayKey);
  const [founder, snapshot, orders, overdueMeasurements] = await Promise.all([
    prisma.user.findFirst({ where: { id: founderId, companyId, active: true, role: Role.DIRECTOR }, select: { id: true } }),
    getDailyCrmSnapshot({ dateKey: reportDateKey, now }),
    prisma.order.findMany({
      where: { companyId, deletedAt: null, lifecycle: { notIn: ["COMPLETED", "CANCELLED"] }, managerUserId: { not: null } },
      select: {
        id: true, number: true, managerUserId: true, partnerId: true, partnerPrice: true, partnerAgreedAt: true,
        promisedAt: true, productionDeadline: true, clientId: true,
        client: { select: { name: true, phone: true, city: true } },
        installation: { select: { scheduledAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.measurement.findMany({
      where: {
        companyId,
        visitDate: { lt: now },
        status: { in: ["ASSIGNED", "IN_PROGRESS"] },
        client: { managerUserId: { not: null } },
      },
      select: {
        id: true, visitDate: true, status: true, city: true,
        client: { select: { id: true, name: true, managerUserId: true } },
        measurerUser: { select: { name: true } },
      },
      orderBy: { visitDate: "asc" },
    }),
  ]);
  if (!founder) throw new Error("FOUNDER_REQUIRED");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${companyId}, 87243)::text`;
    const result = { dailyReportsCreated: 0, readinessTasksCreated: 0, readinessTasksUpdated: 0, orientationsCreated: 0 };
    for (const row of snapshot.managers) {
      const reportKey = `daily-crm:${reportDateKey}:${row.managerId}`;
      const existingReport = await tx.calendarTask.findUnique({ where: { companyId_workflowKey: { companyId, workflowKey: reportKey } }, select: { id: true } });
      if (!existingReport) {
        const task = await tx.calendarTask.create({ data: {
          companyId, workflowKey: reportKey, workflow: CalendarTaskWorkflow.DAILY_CRM_REPORT,
          title: `CRM-отчёт за ${formatDate(reportDateKey)}`, description: dailyReportDescription(row, reportDateKey),
          type: "TASK", priority: "IMPORTANT", dueAt, assigneeId: row.managerId, creatorId: founderId,
          acknowledgementRequired: true,
        } });
        await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "DAILY_CRM_ASSIGNED", actorId: founderId, after: { dateKey: reportDateKey } } });
        result.dailyReportsCreated++;
      }
      const orientationKey = `platform-orientation:v1:${row.managerId}`;
      const existingOrientation = await tx.calendarTask.findUnique({ where: { companyId_workflowKey: { companyId, workflowKey: orientationKey } }, select: { id: true } });
      if (!existingOrientation) {
        const task = await tx.calendarTask.create({ data: {
          companyId, workflowKey: orientationKey, workflow: CalendarTaskWorkflow.PLATFORM_ORIENTATION,
          title: "Ознакомление с рабочим порядком ORDA", description: orientationDescription(),
          type: "TASK", priority: "IMPORTANT", dueAt, assigneeId: row.managerId, creatorId: founderId,
          acknowledgementRequired: true,
        } });
        await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "PLATFORM_ORIENTATION_ASSIGNED", actorId: founderId, after: { version: 1 } } });
        result.orientationsCreated++;
      }
      const attention = orders.map((order) => {
        const issues = orderDataGaps(order);
        const deadline = order.promisedAt ?? order.productionDeadline ?? order.installation?.scheduledAt ?? null;
        if (deadline && deadline < now)
          issues.push(`Просрочен срок ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty" }).format(deadline)}`);
        return { order, issues };
      }).filter((item) => item.order.managerUserId === row.managerId && item.issues.length > 0);
      const measurementsToClose = overdueMeasurements.filter((measurement) => measurement.client.managerUserId === row.managerId);
      if (attention.length || measurementsToClose.length) {
        const readinessKey = `order-readiness:${todayKey}:${row.managerId}`;
        const activeOlderTask = await tx.calendarTask.findFirst({ where: { assigneeId: row.managerId, workflow: CalendarTaskWorkflow.ORDER_DATA_COMPLETION, status: { in: [...ACTIVE_TASK_STATUSES] } }, select: { id: true, title: true, description: true } });
        const existingToday = await tx.calendarTask.findUnique({ where: { companyId_workflowKey: { companyId, workflowKey: readinessKey } }, select: { id: true, title: true, description: true } });
        const title = `Проверить данные: заказы ${attention.length} · замеры ${measurementsToClose.length}`;
        const description = [
          "Проверьте действующие заказы и незакрытые замеры. Дополняйте только подтверждёнными данными. Не угадывайте цену производства, срок, цех или результат замера — если данных нет, уточните у директора и напишите конкретный вопрос.",
          "",
          attention.length ? "ЗАКАЗЫ" : "ЗАКАЗЫ: замечаний нет",
          ...attention.map(({ order, issues }) => `• ${order.number} · ${order.client.name}: ${issues.join(", ")} · /orders/${order.id}`),
          "",
          measurementsToClose.length ? "ЗАМЕРЫ, КОТОРЫЕ НУЖНО ЗАКРЫТЬ" : "ЗАМЕРЫ: просрочек нет",
          ...measurementsToClose.map((measurement) => `• Замер №${measurement.id} · ${measurement.client.name} · ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(measurement.visitDate)} · ${measurement.measurerUser?.name ?? "Замерщик не выбран"} · /measurements?filter=needs-closing&measurement=${measurement.id}`),
          "",
          "По просроченному сроку проверьте фактический этап, запишите причину задержки и согласованный новый срок. После исправления откройте каждую карточку ещё раз и убедитесь, что предупреждение исчезло. В результате перечислите исправленные заказы и оставшиеся вопросы.",
        ].join("\n");
        const target = existingToday ?? activeOlderTask;
        if (!target) {
          const task = await tx.calendarTask.create({ data: {
            companyId, workflowKey: readinessKey, workflow: CalendarTaskWorkflow.ORDER_DATA_COMPLETION,
            title, description,
            type: "TASK", priority: "URGENT", dueAt, assigneeId: row.managerId, creatorId: founderId,
            acknowledgementRequired: true,
          } });
          await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "ORDER_READINESS_ASSIGNED", actorId: founderId, after: { dateKey: todayKey, orderIds: attention.map((item) => item.order.id), measurementIds: measurementsToClose.map((item) => item.id) } } });
          result.readinessTasksCreated++;
        } else if (target.title !== title || target.description !== description) {
          await tx.calendarTask.update({ where: { id: target.id }, data: { title, description } });
          await tx.calendarTaskAudit.create({ data: { taskId: target.id, action: "ORDER_READINESS_REFRESHED", actorId: founderId, after: { dateKey: todayKey, orderIds: attention.map((item) => item.order.id), measurementIds: measurementsToClose.map((item) => item.id) } } });
          result.readinessTasksUpdated++;
        }
      }
    }
    return { ...result, reportDateKey, dueAt };
  }, { timeout: 60_000 });
}
