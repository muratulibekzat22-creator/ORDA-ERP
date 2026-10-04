import { CalendarTaskWorkflow, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { detectControlIssues } from "@/lib/control/rules";

async function inspect(db: Prisma.TransactionClient = prisma, now = new Date()) {
  const companyId = requireTenantIdentity().companyId;
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const [leads, orders, users, tasks] = await Promise.all([
    db.client.findMany({ where: { companyId, active: true, deletedAt: null, stage: { notIn: ["WON", "LOST"] } }, select: {
      id: true, name: true, managerUserId: true, createdAt: true, nextContactAt: true,
      nextActions: { select: { nextActionAt: true, completedAt: true, resultComment: true, nextActionType: true } },
      interactions: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    } }),
    db.order.findMany({ where: { companyId, deletedAt: null, lifecycle: { notIn: ["COMPLETED", "CANCELLED"] } }, select: {
      id: true, number: true, clientId: true, responsibleType: true, managerUserId: true, partnerId: true,
      partnerPrice: true, partnerAgreedAt: true, promisedAt: true, productionDeadline: true, lifecycle: true,
      client: { select: { phone: true, city: true } },
    } }),
    db.user.findMany({ where: { companyId, active: true }, select: { id: true, name: true, role: true } }),
    db.calendarTask.findMany({ where: { companyId, OR: [
      { controlKey: { not: null } },
      { workflow: { in: [CalendarTaskWorkflow.PAYMENT_COLLECTION, CalendarTaskWorkflow.DAILY_CRM_REPORT, CalendarTaskWorkflow.ORDER_DATA_COMPLETION] }, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      { workflow: { in: [CalendarTaskWorkflow.PAYMENT_COLLECTION, CalendarTaskWorkflow.DAILY_CRM_REPORT, CalendarTaskWorkflow.ORDER_DATA_COMPLETION] }, status: "COMPLETED", completedAt: { gte: sevenDaysAgo } },
    ] }, select: {
      id: true, title: true, controlKey: true, workflow: true, expectedAmount: true, assigneeId: true, status: true, dueAt: true, completedAt: true, acknowledgedAt: true,
      resultSubmittedAt: true, controlVerifiedAt: true, controlRemindedAt: true, createdAt: true,
      orderId: true, clientId: true, order: { select: { number: true, responsibleType: true, managerUserId: true, client: { select: { name: true } } } },
    } }),
  ]);
  const directors = users.filter(u => u.role === Role.OPERATIONS_DIRECTOR);
  const activeIds = new Set(users.map(u => u.id));
  const detectedIssues = detectControlIssues(leads, orders, now).map(issue => ({ ...issue,
    assigneeId: issue.assigneeId && activeIds.has(issue.assigneeId) ? issue.assigneeId : directors.length === 1 ? directors[0].id : null,
  }));
  const paymentIssues = tasks.filter(task =>
    task.workflow === CalendarTaskWorkflow.PAYMENT_COLLECTION &&
    task.dueAt < now &&
    !["COMPLETED", "CANCELLED"].includes(task.status) &&
    task.order && task.orderId && task.clientId,
  ).map(task => {
    const currentManagerId = task.order!.responsibleType === "EMPLOYEE"
      ? task.order!.managerUserId
      : null;
    return {
      key: `payment-follow-up:${task.id}`,
      taskId: task.id,
      title: `${task.order!.number}: просрочена доплата`,
      reason: `Клиент ${task.order!.client.name} обещал оплатить ${Number(task.expectedAmount ?? 0).toLocaleString("ru-RU")} ₸ до ${task.dueAt.toISOString()}. Результат не зафиксирован.`,
      action: "Менеджеру необходимо ознакомиться, связаться с клиентом, запросить оплату и записать фактический результат. Поступившие деньги нужно зарегистрировать в заказе.",
      href: `/orders/${task.orderId}`,
      assigneeId: currentManagerId && activeIds.has(currentManagerId)
        ? currentManagerId
        : directors.length === 1
          ? directors[0].id
          : null,
      clientId: task.clientId!,
      orderId: task.orderId!,
      priority: "URGENT" as const,
    };
  });
  const issues = [...paymentIssues, ...detectedIssues];
  return { issues, users, tasks, coverage: { leads: leads.length, orders: orders.length }, checkedAt: now.toISOString() };
}

export async function getFounderControl() {
  const snapshot = await inspect();
  const userNames = new Map(snapshot.users.map((user) => [user.id, user.name]));
  const sevenDaysAgo = new Date(new Date(snapshot.checkedAt).getTime() - 7 * 86400000);
  const completedTasks = snapshot.tasks
    .filter((task) => task.status === "COMPLETED" && task.completedAt && task.completedAt >= sevenDaysAgo)
    .sort((left, right) => Number(right.completedAt) - Number(left.completedAt));
  const issueGroups = [
    {
      key: "group:lead-follow-up",
      rows: snapshot.issues.filter((issue) => issue.key.startsWith("lead:")),
      title: "Заявки требуют следующего действия",
      href: "/clients",
      action: "Менеджеры получают ежедневный CRM-контроль; директор проверяет итог по рабочим кабинетам.",
    },
    {
      key: "group:order-data",
      rows: snapshot.issues.filter((issue) => issue.key.startsWith("order:") && issue.key.endsWith(":data")),
      title: "Заказы нужно дополнить",
      href: "/orders?attention=incomplete",
      action: "Менеджеры заполняют подтверждённый срок, цех и цену производства в одном сводном задании.",
    },
    {
      key: "group:order-deadline",
      rows: snapshot.issues.filter((issue) => issue.key.startsWith("order:") && issue.key.endsWith(":deadline")),
      title: "Просроченные сроки заказов",
      href: "/orders?attention=overdue",
      action: "Директор требует причину, согласованный новый срок и фактический этап; основатель не ведёт переписку.",
    },
    {
      key: "group:payment-follow-up",
      rows: snapshot.issues.filter((issue) => issue.key.startsWith("payment-follow-up:")),
      title: "Просроченные обещанные доплаты",
      href: "/orders",
      action: "Ответственный менеджер связывается с клиентом и фиксирует реальное поступление в заказе.",
    },
  ].filter((group) => group.rows.length > 0);
  const operationsDirector = snapshot.users.find((user) => user.role === Role.OPERATIONS_DIRECTOR);
  return { ...snapshot, issues: issueGroups.map((group) => ({
    key: group.key,
    title: `${group.title}: ${group.rows.length}`,
    reason: `${group.rows.filter((issue) => issue.priority === "URGENT").length} срочных из ${group.rows.length}.`,
    action: group.action,
    href: group.href,
    assignee: operationsDirector ? `Контроль: ${operationsDirector.name}` : "Нужно назначить директора",
    assigneeId: operationsDirector?.id ?? null,
    priority: group.rows.some((issue) => issue.priority === "URGENT") ? "URGENT" : "IMPORTANT",
    urgentCount: group.rows.filter((issue) => issue.priority === "URGENT").length,
    task: null,
    details: group.rows.map((issue) => {
      const linkedTask = snapshot.tasks.find((task) =>
        ["PLANNED", "IN_PROGRESS"].includes(task.status) && (
          ("taskId" in issue && task.id === issue.taskId) ||
          (issue.key.endsWith(":data") && issue.orderId && task.orderId === issue.orderId && task.workflow === CalendarTaskWorkflow.ORDER_DATA_COMPLETION)
        ),
      );
      return {
        key: issue.key,
        title: issue.title,
        reason: issue.reason,
        action: issue.action,
        href: issue.href,
        priority: issue.priority,
        assignee: issue.assigneeId ? userNames.get(issue.assigneeId) ?? "Ответственный не найден" : "Ответственный не назначен",
        status: linkedTask?.status === "IN_PROGRESS"
          ? "В работе"
          : linkedTask?.acknowledgedAt
            ? "Ознакомлен"
            : "Ожидает исправления",
      };
    }),
  })), summary: {
    total: snapshot.issues.length,
    groups: issueGroups.length,
    urgent: snapshot.issues.filter(i => i.priority === "URGENT").length,
    needsOwner: snapshot.issues.filter(i => !i.assigneeId).length,
    unacknowledged: snapshot.tasks.filter(t => !t.acknowledgedAt && !["COMPLETED", "CANCELLED"].includes(t.status) && (t.workflow !== CalendarTaskWorkflow.PAYMENT_COLLECTION || t.dueAt <= new Date())).length,
    overdue: snapshot.tasks.filter(t => t.dueAt < new Date() && !t.controlVerifiedAt && t.status !== "CANCELLED" && t.status !== "COMPLETED").length,
    verified: snapshot.tasks.filter(t => t.controlVerifiedAt).length,
    completedLast7Days: completedTasks.length,
  }, recentCompleted: completedTasks.slice(0, 10).map((task) => ({
    id: task.id,
    title: task.title,
    completedAt: task.completedAt,
    href: task.orderId ? `/orders/${task.orderId}` : task.clientId ? `/clients/${task.clientId}` : "/calendar",
    assignee: userNames.get(task.assigneeId) ?? "Сотрудник",
  })) };
}

export async function runFounderControl(actorId: number, keys?: string[], now = new Date()) {
  const { companyId } = requireTenantIdentity();
  return prisma.$transaction(async tx => {
    // Serialize manual and scheduled runs for this company; the unique key is an additional safeguard.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${companyId}, 87241)::text`;
    const actor = await tx.user.findFirst({ where: { id: actorId, active: true, role: { in: [Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] } } });
    if (!actor) throw new Error("CONTROL_ACTOR_REQUIRED");
    void keys;
    const legacyTasks = await tx.calendarTask.findMany({
      where: { companyId, controlKey: { not: null }, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      select: { id: true, controlKey: true },
    });
    for (const task of legacyTasks) {
      await tx.calendarTask.update({ where: { id: task.id }, data: { status: "CANCELLED", cancelledAt: now } });
      await tx.calendarTaskAudit.create({ data: {
        taskId: task.id,
        action: "CONTROL_CONSOLIDATED",
        actorId,
        after: { checkedAt: now.toISOString(), replacement: "DAILY_CRM_REPORT_AND_ORDER_DATA_COMPLETION" },
      } });
    }
    return { created: 0, reminded: 0, verified: 0, needsOwner: 0, consolidated: legacyTasks.length };
  }, { timeout: 60000 });
}
