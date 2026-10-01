import {
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarTaskType,
  CalendarTaskWorkflow,
  Prisma,
  Role,
} from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";

export type PaymentFollowUpActor = {
  userId: number;
  name: string;
  role: Role;
};

const select = {
  id: true,
  orderId: true,
  dueAt: true,
  status: true,
  priority: true,
  workflow: true,
  workflowKey: true,
  expectedAmount: true,
  acknowledgedAt: true,
  plannedCompletionAt: true,
  resultText: true,
  resultSubmittedAt: true,
  cancelledAt: true,
  createdAt: true,
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  order: {
    select: {
      id: true,
      number: true,
      balance: true,
      managerUserId: true,
      client: { select: { id: true, name: true, phone: true } },
    },
  },
} satisfies Prisma.CalendarTaskSelect;

export const PAYMENT_FOLLOW_UP_MIN_LEAD_MS = 30_000;

export function assertPaymentFollowUpInput(amount: number, dueAt: Date, now = new Date()) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999.99)
    throw new Error("INVALID_PAYMENT_FOLLOW_UP_AMOUNT");
  if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() < now.getTime() + PAYMENT_FOLLOW_UP_MIN_LEAD_MS)
    throw new Error("INVALID_PAYMENT_FOLLOW_UP_DATE");
}

export function paymentPromisesFitBalance(
  activeAmount: Prisma.Decimal.Value,
  nextAmount: Prisma.Decimal.Value,
  balance: Prisma.Decimal.Value,
) {
  return new Prisma.Decimal(activeAmount).add(new Prisma.Decimal(nextAmount)).lessThanOrEqualTo(new Prisma.Decimal(balance));
}

function canManage(actor: PaymentFollowUpActor, managerUserId: number | null) {
  return actor.role === Role.DIRECTOR ||
    actor.role === Role.OPERATIONS_DIRECTOR ||
    (actor.role === Role.MANAGER && managerUserId === actor.userId);
}

export async function listPaymentFollowUps(orderId: number, actor: PaymentFollowUpActor) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { managerUserId: true },
  });
  if (!order || !canManage(actor, order.managerUserId)) throw new Error("ORDER_NOT_FOUND");
  const tasks = await prisma.calendarTask.findMany({
    where: { orderId, workflow: CalendarTaskWorkflow.PAYMENT_COLLECTION },
    select,
    orderBy: [{ dueAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  const now = new Date();
  return tasks.map((task) => ({
    ...task,
    overdue: task.dueAt < now && task.status !== CalendarTaskStatus.COMPLETED && task.status !== CalendarTaskStatus.CANCELLED,
  }));
}

export async function createPaymentFollowUp(input: {
  orderId: number;
  amount: number;
  dueAt: Date;
  actor: PaymentFollowUpActor;
  idempotencyKey: string;
  requestHash: string;
  now?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const workflowKey = `payment-collection:${input.idempotencyKey}`;
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${input.orderId})`;
    const existing = await tx.calendarTask.findFirst({
      where: { workflowKey },
      select: { ...select, auditEvents: { where: { action: "PAYMENT_FOLLOW_UP_SCHEDULED" }, take: 1, select: { after: true } } },
    });
    if (existing) {
      if (existing.orderId !== input.orderId || !existing.order || !canManage(input.actor, existing.order.managerUserId))
        throw new Error("ORDER_NOT_FOUND");
      const audit = existing.auditEvents[0]?.after as { requestHash?: string } | null;
      if (!compareRequestHash(audit?.requestHash ?? null, input.requestHash))
        throw new Error("IDEMPOTENCY_CONFLICT");
      return existing;
    }
    assertPaymentFollowUpInput(input.amount, input.dueAt, input.now ?? new Date());
    const order = await tx.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      select: {
        id: true,
        number: true,
        balance: true,
        clientId: true,
        managerUserId: true,
        manager: true,
        client: { select: { name: true } },
      },
    });
    if (!order || !canManage(input.actor, order.managerUserId)) throw new Error("ORDER_NOT_FOUND");
    if (!order.managerUserId) throw new Error("ORDER_MANAGER_REQUIRED");
    const activePromises = await tx.calendarTask.aggregate({
      where: {
        orderId: order.id,
        workflow: CalendarTaskWorkflow.PAYMENT_COLLECTION,
        status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] },
      },
      _sum: { expectedAmount: true },
    });
    const expectedAmount = new Prisma.Decimal(input.amount);
    if (!paymentPromisesFitBalance(activePromises._sum.expectedAmount ?? 0, expectedAmount, order.balance))
      throw new Error("PAYMENT_FOLLOW_UPS_EXCEED_BALANCE");

    const amountLabel = Math.round(input.amount).toLocaleString("ru-RU");
    const task = await tx.calendarTask.create({
      data: {
        title: `Получить доплату ${amountLabel} ₸ · ${order.number}`,
        description: `Клиент ${order.client.name} обещал внести ${amountLabel} ₸. В указанный срок свяжитесь с клиентом, напомните об оплате и зафиксируйте фактический результат в ORDA. Если деньги поступили, зарегистрируйте оплату в заказе.`,
        type: CalendarTaskType.REMINDER,
        dueAt: input.dueAt,
        status: CalendarTaskStatus.PLANNED,
        priority: CalendarTaskPriority.URGENT,
        assigneeId: order.managerUserId,
        creatorId: input.actor.userId,
        clientId: order.clientId,
        orderId: order.id,
        acknowledgementRequired: true,
        workflow: CalendarTaskWorkflow.PAYMENT_COLLECTION,
        workflowKey,
        expectedAmount,
      },
      select,
    });
    await tx.calendarTaskAudit.create({
      data: {
        taskId: task.id,
        action: "PAYMENT_FOLLOW_UP_SCHEDULED",
        actorId: input.actor.userId,
        after: { amount: input.amount, dueAt: input.dueAt.toISOString(), requestHash: input.requestHash },
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        title: "Запланирована доплата клиента",
        description: `${amountLabel} ₸ · ${input.dueAt.toISOString()}`,
        user: input.actor.name,
      },
    });
    return task;
  });
}
export async function cancelPaymentFollowUp(input: {
  orderId: number;
  taskId: number;
  reason: string;
  actor: PaymentFollowUpActor;
}) {
  const reason = input.reason.trim().slice(0, 1000);
  if (reason.length < 5) throw new Error("PAYMENT_FOLLOW_UP_CANCEL_REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const task = await tx.calendarTask.findFirst({
      where: { id: input.taskId, orderId: input.orderId, workflow: CalendarTaskWorkflow.PAYMENT_COLLECTION },
      select: { id: true, status: true, dueAt: true, order: { select: { id: true, number: true, managerUserId: true } } },
    });
    if (!task || !task.order || !canManage(input.actor, task.order.managerUserId)) throw new Error("PAYMENT_FOLLOW_UP_NOT_FOUND");
    if (task.status === CalendarTaskStatus.COMPLETED || task.status === CalendarTaskStatus.CANCELLED)
      throw new Error("PAYMENT_FOLLOW_UP_TERMINAL");
    const now = new Date();
    if (input.actor.role === Role.MANAGER && task.dueAt <= now)
      throw new Error("PAYMENT_FOLLOW_UP_DIRECTOR_REQUIRED");
    const updated = await tx.calendarTask.update({
      where: { id: task.id },
      data: { status: CalendarTaskStatus.CANCELLED, cancelledAt: now },
      select,
    });
    await tx.calendarTaskAudit.create({
      data: { taskId: task.id, action: "PAYMENT_FOLLOW_UP_CANCELLED", actorId: input.actor.userId, before: { status: task.status, dueAt: task.dueAt }, after: { status: CalendarTaskStatus.CANCELLED, reason } },
    });
    await tx.orderEvent.create({ data: { orderId: task.order.id, title: "Отменено обещание доплаты", description: `${reason} · срок ${task.dueAt.toISOString()}`, user: input.actor.name } });
    return updated;
  });
}
