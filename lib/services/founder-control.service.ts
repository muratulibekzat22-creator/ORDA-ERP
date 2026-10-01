import { CalendarTaskWorkflow, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { detectControlIssues } from "@/lib/control/rules";

async function inspect(db: Prisma.TransactionClient = prisma, now = new Date()) {
  const [leads, orders, users, tasks] = await Promise.all([
    db.client.findMany({ where: { active: true, deletedAt: null, stage: { notIn: ["WON", "LOST"] } }, select: {
      id: true, name: true, managerUserId: true, createdAt: true, nextContactAt: true,
      nextActions: { select: { nextActionAt: true, completedAt: true, resultComment: true, nextActionType: true } },
      interactions: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    } }),
    db.order.findMany({ where: { deletedAt: null, lifecycle: { notIn: ["COMPLETED", "CANCELLED"] } }, select: {
      id: true, number: true, clientId: true, managerUserId: true, partnerId: true,
      partnerPrice: true, partnerAgreedAt: true, promisedAt: true, productionDeadline: true, lifecycle: true,
      client: { select: { phone: true, city: true } },
    } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true, role: true } }),
    db.calendarTask.findMany({ where: { OR: [{ controlKey: { not: null } }, { workflow: CalendarTaskWorkflow.PAYMENT_COLLECTION, status: { in: ["PLANNED", "IN_PROGRESS"] } }] }, select: {
      id: true, controlKey: true, workflow: true, expectedAmount: true, assigneeId: true, status: true, dueAt: true, acknowledgedAt: true,
      resultSubmittedAt: true, controlVerifiedAt: true, controlRemindedAt: true, createdAt: true,
      orderId: true, clientId: true, order: { select: { number: true, client: { select: { name: true } } } },
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
  ).map(task => ({
    key: `payment-follow-up:${task.id}`,
    taskId: task.id,
    title: `${task.order!.number}: просрочена доплата`,
    reason: `Клиент ${task.order!.client.name} обещал оплатить ${Number(task.expectedAmount ?? 0).toLocaleString("ru-RU")} ₸ до ${task.dueAt.toISOString()}. Результат не зафиксирован.`,
    action: "Менеджеру необходимо ознакомиться, связаться с клиентом, запросить оплату и записать фактический результат. Поступившие деньги нужно зарегистрировать в заказе.",
    href: `/orders/${task.orderId}`,
    assigneeId: activeIds.has(task.assigneeId) ? task.assigneeId : directors.length === 1 ? directors[0].id : null,
    clientId: task.clientId!,
    orderId: task.orderId!,
    priority: "URGENT" as const,
  }));
  const issues = [...paymentIssues, ...detectedIssues];
  return { issues, users, tasks, coverage: { leads: leads.length, orders: orders.length }, checkedAt: now.toISOString() };
}

export async function getFounderControl() {
  const snapshot = await inspect();
  return { ...snapshot, issues: snapshot.issues.map(issue => ({ ...issue,
    assignee: snapshot.users.find(u => u.id === issue.assigneeId)?.name ?? "Требуется назначить ответственного",
    task: snapshot.tasks.find(t => ("taskId" in issue && issue.taskId ? t.id === issue.taskId : t.controlKey === issue.key)) ?? null,
  })), summary: {
    urgent: snapshot.issues.filter(i => i.priority === "URGENT").length,
    needsOwner: snapshot.issues.filter(i => !i.assigneeId).length,
    unacknowledged: snapshot.tasks.filter(t => !t.acknowledgedAt && !["COMPLETED", "CANCELLED"].includes(t.status) && (t.workflow !== CalendarTaskWorkflow.PAYMENT_COLLECTION || t.dueAt <= new Date())).length,
    overdue: snapshot.tasks.filter(t => t.dueAt < new Date() && !t.controlVerifiedAt && t.status !== "CANCELLED" && t.status !== "COMPLETED").length,
    verified: snapshot.tasks.filter(t => t.controlVerifiedAt).length,
  } };
}

export async function runFounderControl(actorId: number, keys?: string[], now = new Date()) {
  const { companyId } = requireTenantIdentity();
  return prisma.$transaction(async tx => {
    // Serialize manual and scheduled runs for this company; the unique key is an additional safeguard.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${companyId}, 87241)::text`;
    const actor = await tx.user.findFirst({ where: { id: actorId, active: true, role: Role.DIRECTOR } });
    if (!actor) throw new Error("FOUNDER_REQUIRED");
    const snapshot = await inspect(tx, now);
    const currentKeys = new Set(snapshot.issues.map(i => i.key));
    const result = { created: 0, reminded: 0, verified: 0, needsOwner: 0 };
    for (const task of snapshot.tasks) {
      if (!task.controlKey) continue;
      if (!currentKeys.has(task.controlKey!) && !task.controlVerifiedAt && task.status !== "CANCELLED") {
        await tx.calendarTask.update({ where: { id: task.id }, data: { controlVerifiedAt: now, status: "COMPLETED", completedAt: now } });
        await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "CONTROL_VERIFIED", actorId,
          after: { checkedAt: now.toISOString() } } });
        result.verified++;
      }
    }
    for (const issue of snapshot.issues.filter(i => !keys || keys.includes(i.key))) {
      if ("taskId" in issue && issue.taskId) continue;
      if (!issue.assigneeId) { result.needsOwner++; continue; }
      const existing = snapshot.tasks.find(t => t.controlKey === issue.key);
      const description = `Автоконтроль ORDA по поручению основателя.\n\n${issue.reason}\n\n${issue.action}\n\nКарточка: ${issue.href}\nРезультат проверяется по данным ORDA. Если причина не устранена, задача остаётся на контроле.`;
      if (!existing) {
        const task = await tx.calendarTask.create({ data: { controlKey: issue.key, title: issue.title,
          description, type: "TASK", priority: issue.priority, dueAt: new Date(now.getTime() + 86400000),
          assigneeId: issue.assigneeId, creatorId: actorId, clientId: issue.clientId, orderId: issue.orderId,
          acknowledgementRequired: true } });
        await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "CONTROL_ASSIGNED", actorId,
          after: { key: issue.key, reason: issue.reason } } });
        result.created++;
        continue;
      }
      // Explicit cancellation is respected. Reminders never create extra tasks.
      if (existing.status === "CANCELLED") continue;
      const changedAssignee = existing.assigneeId !== issue.assigneeId;
      const recurrence = Boolean(existing.controlVerifiedAt);
      const reminderDue = existing.dueAt <= now && now.getTime() - (existing.controlRemindedAt ?? existing.createdAt).getTime() >= 86400000;
      if (!changedAssignee && !recurrence && !reminderDue) continue;
      await tx.calendarTask.update({ where: { id: existing.id }, data: {
        description, title: issue.title, assigneeId: issue.assigneeId, priority: issue.priority,
        status: "PLANNED", acknowledgedAt: null, acknowledgementComment: null,
        controlVerifiedAt: null, completedAt: null, completedById: null,
        resultSubmittedAt: null, resultText: null,
        controlRemindedAt: now,
        ...(recurrence || changedAssignee ? { dueAt: new Date(now.getTime() + 86400000), plannedCompletionAt: null } : {}),
      } });
      await tx.calendarTaskAudit.create({ data: { taskId: existing.id, action: recurrence ? "CONTROL_REOPENED" : "CONTROL_REMINDER", actorId,
        after: { reason: issue.reason, previousResultSubmittedAt: existing.resultSubmittedAt?.toISOString() ?? null } } });
      result.reminded++;
    }
    return result;
  }, { timeout: 60000 });
}
