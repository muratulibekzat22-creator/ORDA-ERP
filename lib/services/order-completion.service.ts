import {
  CalendarTaskStatus,
  MarketingContentConsent,
  MarketingContentTaskStatus,
  OrderLifecycle,
  PayrollDirection,
  Prisma,
  Role,
} from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type OrderCompletionActor = {
  userId: number;
  name: string;
  role: Role;
};

export class OrderCompletionError extends Error {}

const text = (value: string | undefined, max = 2000) =>
  value?.trim().slice(0, max) || null;

function consent(value: "YES" | "NO" | "UNKNOWN") {
  return MarketingContentConsent[value];
}

function managerScope(actor: OrderCompletionActor) {
  return actor.role === Role.MANAGER
    ? {
        OR: [
          { managerUserId: actor.userId },
          { managerUserId: null, manager: actor.name },
          { leadConversion: { managerId: actor.userId } },
        ],
      }
    : {};
}

export async function completeDeliveredOrder(
  input: {
    orderId: number;
    completedAt: Date;
    comment?: string;
    clientAccepted: boolean;
    contactConsent: "YES" | "NO" | "UNKNOWN";
    photoVideoConsent: "YES" | "NO" | "UNKNOWN";
    idempotencyKey: string;
    requestHash: string;
  },
  actor: OrderCompletionActor,
) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER)
    throw new OrderCompletionError("FORBIDDEN");
  if (Number.isNaN(input.completedAt.getTime()))
    throw new OrderCompletionError("INVALID_DATE");
  const tenant = requireTenantIdentity().companyId;
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${input.orderId})`;
      const replay = await tx.orderLifecycleEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) {
        if (!compareRequestHash(replay.requestHash, input.requestHash))
          throw new OrderCompletionError("IDEMPOTENCY_CONFLICT");
        return {
          created: false,
          event: replay,
          task: await tx.marketingContentTask.findUnique({
            where: { orderId: input.orderId },
          }),
        };
      }
      const order = await tx.order.findFirst({
        where: {
          id: input.orderId,
          companyId: tenant,
          deletedAt: null,
          ...managerScope(actor),
        },
        select: {
          id: true,
          clientId: true,
          number: true,
          lifecycle: true,
          completedAt: true,
        },
      });
      if (!order) throw new OrderCompletionError("ORDER_NOT_FOUND");
      if (order.lifecycle === OrderLifecycle.CANCELLED)
        throw new OrderCompletionError("ORDER_CANCELLED");
      const existingTask = await tx.marketingContentTask.findUnique({
        where: { orderId: order.id },
      });
      if (order.lifecycle === OrderLifecycle.COMPLETED && existingTask)
        return { created: false, task: existingTask, event: null };

      const marketer = await tx.user.findFirst({
        where: { companyId: tenant, active: true, role: Role.MARKETER },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          lifecycle: OrderLifecycle.COMPLETED,
          status: "Заказ завершён",
          completedAt: input.completedAt,
          operationalAcceptedAt: input.clientAccepted
            ? input.completedAt
            : undefined,
          version: { increment: 1 },
        },
      });
      await tx.production.updateMany({
        where: { orderId: order.id, archivedAt: null },
        data: {
          percent: 100,
          completedAt: input.completedAt,
          actualEndAt: input.completedAt,
          finishDate: input.completedAt,
        },
      });
      await tx.calendarTask.updateMany({
        where: {
          orderId: order.id,
          status: {
            in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS],
          },
        },
        data: {
          status: CalendarTaskStatus.COMPLETED,
          completedAt: input.completedAt,
          completedById: actor.userId,
        },
      });
      const task = await tx.marketingContentTask.upsert({
        where: { orderId: order.id },
        create: {
          companyId: tenant,
          orderId: order.id,
          clientId: order.clientId,
          assignedMarketerId: marketer?.id ?? null,
          status:
            input.contactConsent === "NO"
              ? MarketingContentTaskStatus.REFUSED
              : MarketingContentTaskStatus.NEW,
          contactConsent: consent(input.contactConsent),
          photoVideoConsent: consent(input.photoVideoConsent),
          comment: text(input.comment),
          createdById: actor.userId,
        },
        update: {},
      });
      const event = await tx.orderLifecycleEvent.create({
        data: {
          orderId: order.id,
          type: "ORDER_DELIVERED",
          fromLifecycle: order.lifecycle,
          toLifecycle: OrderLifecycle.COMPLETED,
          message: text(input.comment),
          actorId: actor.userId,
          actorName: actor.name,
          role: actor.role,
          metadata: {
            clientAccepted: input.clientAccepted,
            contactConsent: input.contactConsent,
            photoVideoConsent: input.photoVideoConsent,
            marketingTaskId: task.id,
            marketerAssigned: Boolean(marketer),
          },
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        },
      });
      await tx.orderEvent.create({
        data: {
          companyId: tenant,
          orderId: order.id,
          title: "Объект сдан",
          description: text(input.comment),
          user: actor.name,
          idempotencyKey: `${input.idempotencyKey}:event`,
          requestHash: input.requestHash,
        },
      });
      return { created: true, task, event };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 20_000,
    },
  );
}

export async function closeOrderFinancially(
  input: {
    orderId: number;
    reason: string;
    idempotencyKey: string;
    requestHash: string;
  },
  actor: OrderCompletionActor,
) {
  if (actor.role !== Role.DIRECTOR)
    throw new OrderCompletionError("FORBIDDEN");
  const reason = text(input.reason, 1000);
  if (!reason) throw new OrderCompletionError("REASON_REQUIRED");
  const tenant = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${input.orderId})`;
    const replay = await tx.orderEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      if (!compareRequestHash(replay.requestHash, input.requestHash))
        throw new OrderCompletionError("IDEMPOTENCY_CONFLICT");
      return { created: false, event: replay };
    }
    const order = await tx.order.findFirst({
      where: { id: input.orderId, companyId: tenant, deletedAt: null },
      include: {
        payrollAccruals: {
          include: { payments: true, reversedBy: { select: { id: true } } },
        },
      },
    });
    if (!order) throw new OrderCompletionError("ORDER_NOT_FOUND");
    if (order.lifecycle !== OrderLifecycle.COMPLETED || !order.completedAt)
      throw new OrderCompletionError("ORDER_NOT_COMPLETED");
    if (!order.partnerId || !order.partnerAgreedAt)
      throw new OrderCompletionError("ORDER_SETTLEMENT_INCOMPLETE");
    const payrollRemaining = order.payrollAccruals.reduce((sum, accrual) => {
      if (accrual.reversedBy) return sum;
      const signed =
        accrual.direction === PayrollDirection.INCREASE
          ? accrual.amount
          : accrual.amount.negated();
      const paid = accrual.payments
        .filter((payment) => !payment.reversalOfId && !payment.reversedAt)
        .reduce(
          (paymentSum, payment) => paymentSum.add(payment.amount),
          new Prisma.Decimal(0),
        );
      return sum.add(Prisma.Decimal.max(signed.sub(paid), 0));
    }, new Prisma.Decimal(0));
    const blockers = {
      clientRemaining: Prisma.Decimal.max(order.balance, 0),
      partnerRemaining: order.partnerAgreedAt
        ? Prisma.Decimal.max(order.partnerBalance, 0)
        : new Prisma.Decimal(0),
      payrollRemaining,
    };
    if (Object.values(blockers).some((value) => value.gt(0)))
      throw new OrderCompletionError(
        `OBLIGATIONS_OPEN:${blockers.clientRemaining}:${blockers.partnerRemaining}:${blockers.payrollRemaining}`,
      );
    const closedAt = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: { financialClosedAt: closedAt },
    });
    const event = await tx.orderEvent.create({
      data: {
        companyId: tenant,
        orderId: order.id,
        title: "Заказ финансово закрыт",
        description: reason,
        user: actor.name,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: order.id,
        action: "ORDER_FINANCIALLY_CLOSED",
        entityType: "Order",
        entityId: order.id,
        before: { financialClosedAt: order.financialClosedAt },
        after: { financialClosedAt: closedAt },
        reason,
        authorId: actor.userId,
      },
    });
    return { created: true, event, financialClosedAt: closedAt };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
  });
}
