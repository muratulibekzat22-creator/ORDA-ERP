import {
  CalendarTaskStatus,
  MeasurementStatus,
  Prisma,
  Role,
} from "@prisma/client";

import { canAccessLead } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";

export type ClientLifecycleActor = {
  userId: number;
  role: Role;
  name: string;
};

export class ClientLifecycleError extends Error {}

const clientLifecycleSelect = {
  id: true,
  name: true,
  phone: true,
  manager: true,
  managerUserId: true,
  active: true,
  deletedAt: true,
  deletedById: true,
  orders: { select: { id: true, number: true }, orderBy: { createdAt: "desc" as const } },
  measurements: {
    where: {
      status: {
        in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS],
      },
    },
    select: { id: true, status: true, calendarTaskId: true },
  },
  _count: {
    select: {
      measurements: true,
      commercialProposals: true,
      documents: true,
      orders: true,
      calendarTasks: true,
    },
  },
} satisfies Prisma.ClientSelect;

function assertDeleteAccess(
  actor: ClientLifecycleActor,
  client: { managerUserId: number | null },
) {
  if (
    (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER) ||
    !canAccessLead(actor.role, actor.userId, client)
  )
    throw new ClientLifecycleError("NOT_FOUND");
}

export async function deleteClientFromWork(
  actor: ClientLifecycleActor,
  clientId: number,
  reason?: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: clientLifecycleSelect,
      });
      if (!client) throw new ClientLifecycleError("NOT_FOUND");
      assertDeleteAccess(actor, client);
      if (client.deletedAt)
        return {
          client,
          alreadyDeleted: true,
          cancelledMeasurementIds: [] as number[],
          orderNumbers: client.orders.map((order) => order.number),
        };

      const now = new Date();
      const cancellationComment = [
        "APPLICATION_DELETED",
        reason?.trim().slice(0, 1000),
      ]
        .filter(Boolean)
        .join(" · ");

      for (const measurement of client.measurements) {
        if (measurement.calendarTaskId) {
          await tx.calendarTask.update({
            where: { id: measurement.calendarTaskId },
            data: {
              status: CalendarTaskStatus.CANCELLED,
              cancelledAt: now,
            },
          });
          await tx.calendarTaskAudit.create({
            data: {
              taskId: measurement.calendarTaskId,
              action: "CANCELLED",
              actorId: actor.userId,
              before: { measurementStatus: measurement.status },
              after: {
                status: CalendarTaskStatus.CANCELLED,
                cancelledAt: now,
                reason: "APPLICATION_DELETED",
              },
            },
          });
        }
        await tx.measurement.update({
          where: { id: measurement.id },
          data: {
            status: MeasurementStatus.CANCELLED,
            cancelledAt: now,
          },
        });
        await tx.measurementAudit.create({
          data: {
            measurementId: measurement.id,
            action: "MEASUREMENT_CANCELLED",
            actorId: actor.userId,
            comment: cancellationComment,
            before: { status: measurement.status },
            after: {
              status: MeasurementStatus.CANCELLED,
              cancelledAt: now,
              reason: "APPLICATION_DELETED",
            },
          },
        });
      }

      await tx.leadNextAction.updateMany({
        where: { clientId, completedAt: null },
        data: {
          completedAt: now,
          completedByUserId: actor.userId,
          resultComment: "Заявка удалена из рабочего списка",
        },
      });
      const deleted = await tx.client.update({
        where: { id: clientId },
        data: { active: false, deletedAt: now, deletedById: actor.userId },
      });
      await tx.leadActivity.create({
        data: {
          clientId,
          type: "APPLICATION_DELETED",
          comment: reason?.trim().slice(0, 1000) || "Заявка удалена из рабочего списка",
          authorId: actor.userId,
          authorName: actor.name,
        },
      });
      await tx.clientDeletionAudit.create({
        data: {
          deletedClientId: client.id,
          clientSnapshot: {
            id: client.id,
            name: client.name,
            phone: client.phone,
            manager: client.manager,
            managerUserId: client.managerUserId,
          },
          impact: {
            ...client._count,
            cancelledMeasurements: client.measurements.length,
            preservedOrders: client.orders.length,
          },
          reason: reason?.trim().slice(0, 1000) || "Удалено из рабочего списка",
          actorId: actor.userId,
        },
      });
      return {
        client: deleted,
        alreadyDeleted: false,
        cancelledMeasurementIds: client.measurements.map((item) => item.id),
        orderNumbers: client.orders.map((order) => order.number),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function restoreClient(
  actor: ClientLifecycleActor,
  clientId: number,
) {
  if (actor.role !== Role.DIRECTOR)
    throw new ClientLifecycleError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        active: true,
        deletedAt: true,
        deletedById: true,
      },
    });
    if (!client) throw new ClientLifecycleError("NOT_FOUND");
    if (!client.deletedAt) return { client, alreadyRestored: true };
    const restored = await tx.client.update({
      where: { id: clientId },
      data: { active: true, deletedAt: null, deletedById: null },
    });
    await tx.leadActivity.create({
      data: {
        clientId,
        type: "APPLICATION_RESTORED",
        comment: "Заявка восстановлена в рабочем списке",
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    return { client: restored, alreadyRestored: false };
  });
}
