import { Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type OrderDeletionActor = {
  userId: number;
  role: Role;
  name: string;
};

export class OrderDeletionError extends Error {}

const deletionSelect = {
  id: true,
  number: true,
  manager: true,
  managerUserId: true,
  lifecycle: true,
  deletedAt: true,
  deletedById: true,
  leadConversion: { select: { managerId: true } },
  productions: {
    select: {
      id: true,
      percent: true,
      completedAt: true,
      actualEndAt: true,
      archivedAt: true,
      archiveReason: true,
    },
  },
  _count: {
    select: {
      payments: true,
      documents: true,
      measurements: true,
      productions: true,
      partnerAssignmentHistory: true,
      payrollAccruals: true,
      companyLedgerEntries: true,
      financeAuditEvents: true,
      materialMovements: true,
      materialReservations: true,
    },
  },
} satisfies Prisma.OrderSelect;

function canDelete(
  actor: OrderDeletionActor,
  order: {
    managerUserId: number | null;
    manager: string;
    leadConversion: { managerId: number | null } | null;
  },
) {
  if (actor.role === Role.DIRECTOR) return true;
  if (actor.role !== Role.MANAGER) return false;
  return (
    order.managerUserId === actor.userId ||
    order.leadConversion?.managerId === actor.userId ||
    (!order.managerUserId && order.manager === actor.name)
  );
}

function impactOf(
  order: Prisma.OrderGetPayload<{ select: typeof deletionSelect }>,
) {
  const counts = order._count;
  return {
    hasFinancialHistory:
      counts.payments > 0 ||
      counts.companyLedgerEntries > 0 ||
      counts.financeAuditEvents > 0 ||
      counts.payrollAccruals > 0,
    payments: counts.payments,
    documents: counts.documents,
    measurements: counts.measurements,
    productions: counts.productions,
    partnerSettlements: counts.partnerAssignmentHistory,
    payrollAccruals: counts.payrollAccruals,
    warehouseRecords: counts.materialMovements + counts.materialReservations,
  };
}

export async function deleteOrderFromWork(
  actor: OrderDeletionActor,
  orderId: number,
  reason?: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: deletionSelect,
      });
      if (!order) throw new OrderDeletionError("NOT_FOUND");
      if (!canDelete(actor, order))
        throw new OrderDeletionError("FORBIDDEN");

      const impact = impactOf(order);
      if (order.deletedAt)
        return {
          order,
          impact,
          alreadyDeleted: true,
          archivedProductionIds: [] as number[],
        };

      const now = new Date();
      const reasonText = reason?.trim().slice(0, 1000) || null;
      const productionIds = order.productions
        .filter(
          (production) =>
            !production.archivedAt &&
            !production.completedAt &&
            !production.actualEndAt &&
            production.percent < 100,
        )
        .map((production) => production.id);

      if (productionIds.length) {
        await tx.production.updateMany({
          where: { id: { in: productionIds }, archivedAt: null },
          data: { archivedAt: now, archiveReason: "ORDER_DELETED" },
        });
      }

      const deleted = await tx.order.update({
        where: { id: orderId },
        data: { deletedAt: now, deletedById: actor.userId },
      });
      await tx.orderLifecycleEvent.create({
        data: {
          orderId,
          type: "ORDER_DELETED",
          fromLifecycle: order.lifecycle,
          toLifecycle: order.lifecycle,
          message: reasonText,
          actorId: actor.userId,
          actorName: actor.name,
          role: actor.role,
          metadata: {
            reason: reasonText,
            impact,
            archivedProductionIds: productionIds,
          },
        },
      });

      return {
        order: deleted,
        impact,
        alreadyDeleted: false,
        archivedProductionIds: productionIds,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function restoreOrder(actor: OrderDeletionActor, orderId: number) {
  if (actor.role !== Role.DIRECTOR) throw new OrderDeletionError("FORBIDDEN");

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        lifecycle: true,
        deletedAt: true,
      },
    });
    if (!order) throw new OrderDeletionError("NOT_FOUND");
    if (!order.deletedAt) return { order, alreadyRestored: true };

    const restoredProduction = await tx.production.updateMany({
      where: { orderId, archiveReason: "ORDER_DELETED" },
      data: { archivedAt: null, archiveReason: null },
    });
    const restored = await tx.order.update({
      where: { id: orderId },
      data: { deletedAt: null, deletedById: null },
    });
    await tx.orderLifecycleEvent.create({
      data: {
        orderId,
        type: "ORDER_RESTORED",
        fromLifecycle: order.lifecycle,
        toLifecycle: order.lifecycle,
        actorId: actor.userId,
        actorName: actor.name,
        role: actor.role,
        metadata: { restoredProductionCount: restoredProduction.count },
      },
    });
    return {
      order: restored,
      alreadyRestored: false,
      restoredProductionCount: restoredProduction.count,
    };
  });
}
