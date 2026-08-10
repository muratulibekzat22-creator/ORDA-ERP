import { Prisma, Role } from "@prisma/client";

import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import {
  allowedAssigneeRoles,
  canAccessProduction,
  canCreateProduction,
  canReassignProduction,
  canTransitionProduction,
} from "@/lib/production/access-policy";
import {
  isCompletedProductionStage,
  isProductionStage,
  type ProductionStage,
} from "@/lib/production/stage-policy";

export type ProductionActor = { role: Role; userId: number; name: string | null };

export type ProductionWriteData = {
  stage?: ProductionStage;
  percent?: number;
  masterUserId?: number;
  comment?: string;
  priority?: number;
  startDate?: Date | null;
  finishDate?: Date | null;
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
};

export class ProductionServiceError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "INVALID_STAGE" | "INVALID_ASSIGNEE" | "INVALID_DATES" | "IDEMPOTENCY_CONFLICT") {
    super(code);
  }
}

const productionInclude = {
  order: {
    select: {
      id: true,
      number: true,
      address: true,
      material: true,
      client: { select: { name: true } },
    },
  },
  masterUser: { select: { id: true, name: true } },
  stageHistory: {
    orderBy: { createdAt: "desc" as const },
    take: 20,
  },
} satisfies Prisma.ProductionInclude;

function scopeWhere(actor: ProductionActor): Prisma.ProductionWhereInput {
  const active = { archivedAt: null, order: { deletedAt: null } } as const;
  if (actor.role === Role.DIRECTOR || actor.role === Role.MANAGER) return active;
  if (actor.role === Role.PRODUCTION) return { ...active, masterUserId: actor.userId, stage: { notIn: ["Монтаж", "Сдано"] } };
  if (actor.role === Role.INSTALLER) return { ...active, masterUserId: actor.userId, stage: "Монтаж" };
  return { id: -1 };
}

async function getAssignee(tx: Prisma.TransactionClient, userId: number, stage: ProductionStage) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, active: true } });
  if (!user || !user.active || !allowedAssigneeRoles(stage).includes(user.role)) {
    throw new ProductionServiceError("INVALID_ASSIGNEE");
  }
  return user;
}

export async function getProductions(
  actor?: ProductionActor,
  options: { skip?: number; take?: number } = {},
) {
  const productions = await prisma.production.findMany({
    where: actor ? scopeWhere(actor) : { archivedAt: null, order: { deletedAt: null } },
    include: productionInclude,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    skip: Math.max(0, options.skip ?? 0),
    take: Math.min(100, Math.max(1, options.take ?? 100)),
  });
  const userIds = [...new Set(productions.flatMap((item) => item.stageHistory.map((history) => history.changedByUserId)).filter((id): id is number => id !== null))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  return productions.map((production) => ({
    ...production,
    stageHistory: production.stageHistory.map((history) => ({
      ...history,
      changedBy: history.changedByUserId ? { id: history.changedByUserId, name: userNames.get(history.changedByUserId) ?? "Удалённый пользователь" } : null,
    })),
  }));
}

export function countProductions(actor: ProductionActor) {
  return prisma.production.count({ where: scopeWhere(actor) });
}

export async function getProductionOptions(actor: ProductionActor) {
  if (!canCreateProduction(actor.role)) throw new ProductionServiceError("FORBIDDEN");
  const [orders, assignees] = await Promise.all([
    prisma.order.findMany({
      where: { deletedAt: null, productions: { none: { archivedAt: null } } },
      select: { id: true, number: true, address: true, material: true, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: [Role.PRODUCTION, Role.INSTALLER] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { orders, assignees };
}

export async function getProduction(id: number, actor?: ProductionActor) {
  const production = await prisma.production.findFirst({
    where: { id, ...(actor ? scopeWhere(actor) : { archivedAt: null, order: { deletedAt: null } }) },
    include: productionInclude,
  });
  if (!production) return null;
  const userIds = production.stageHistory.map((item) => item.changedByUserId).filter((value): value is number => value !== null);
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return { ...production, stageHistory: production.stageHistory.map((history) => ({
    ...history,
    changedBy: history.changedByUserId ? { id: history.changedByUserId, name: names.get(history.changedByUserId) ?? "Удалённый пользователь" } : null,
  })) };
}

export async function createProductionCommand(input: {
  orderId: number;
  data: ProductionWriteData & { stage: ProductionStage; percent: number; masterUserId: number };
  actor: ProductionActor;
  idempotencyKey: string;
  requestHash: string;
}) {
  if (!canCreateProduction(input.actor.role)) throw new ProductionServiceError("FORBIDDEN");

  const repeated = await prisma.production.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: productionInclude });
  if (repeated) {
    if (!compareRequestHash(repeated.requestHash, input.requestHash)) throw new ProductionServiceError("IDEMPOTENCY_CONFLICT");
    return { production: repeated, created: false };
  }

  try {
    const production = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: input.orderId, deletedAt: null }, select: { id: true } });
      if (!order) return null;
      const existing = await tx.production.findFirst({ where: { orderId: input.orderId }, select: { id: true } });
      if (existing) throw new ProductionServiceError("IDEMPOTENCY_CONFLICT");
      const assignee = await getAssignee(tx, input.data.masterUserId, input.data.stage);
      const now = new Date();
      const completed = isCompletedProductionStage(input.data.stage);
      const productionData = { ...input.data, masterUserId: undefined };
      const created = await tx.production.create({
        data: {
          ...productionData,
          order: { connect: { id: input.orderId } },
          masterUser: { connect: { id: assignee.id } },
          master: assignee.name,
          completedAt: completed ? now : null,
          actualEndAt: completed ? now : null,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          stageHistory: {
            create: {
              fromStage: null,
              toStage: input.data.stage,
              changedByUserId: input.actor.userId,
              comment: input.data.comment,
              idempotencyKey: input.idempotencyKey,
              requestHash: input.requestHash,
            },
          },
        },
        include: productionInclude,
      });
      await tx.orderEvent.create({
        data: {
          orderId: input.orderId,
          title: "Производство создано",
          description: `Этап: ${input.data.stage} • Готовность: ${input.data.percent}%`,
          user: input.actor.name,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        },
      });
      return created;
    });
    return production ? { production, created: true } : null;
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    const repeatedAfterRace = await prisma.production.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: productionInclude });
    if (!repeatedAfterRace || !compareRequestHash(repeatedAfterRace.requestHash, input.requestHash)) {
      throw new ProductionServiceError("IDEMPOTENCY_CONFLICT");
    }
    return { production: repeatedAfterRace, created: false };
  }
}

export async function updateProductionCommand(input: {
  id: number;
  data: ProductionWriteData;
  actor: ProductionActor;
  idempotencyKey: string;
  requestHash: string;
}) {
  const current = await prisma.production.findFirst({ where: { id: input.id, archivedAt: null, order: { deletedAt: null } } });
  if (!current) return null;
  const [repeatedEvent, repeatedHistory] = await Promise.all([
    prisma.orderEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } }),
    prisma.productionStageHistory.findUnique({ where: { idempotencyKey: input.idempotencyKey } }),
  ]);
  if (repeatedEvent) {
    const actorCanReplay = isProductionStage(current.stage) && (
      canAccessProduction(input.actor.role, input.actor.userId, { ...current, stage: current.stage }) ||
      repeatedHistory?.changedByUserId === input.actor.userId
    );
    if (!actorCanReplay || repeatedEvent.orderId !== current.orderId || !compareRequestHash(repeatedEvent.requestHash, input.requestHash)) {
      throw new ProductionServiceError("IDEMPOTENCY_CONFLICT");
    }
    return prisma.production.findUnique({ where: { id: input.id }, include: productionInclude });
  }
  if (!isProductionStage(current.stage) || !canAccessProduction(input.actor.role, input.actor.userId, { ...current, stage: current.stage })) {
    throw new ProductionServiceError("FORBIDDEN");
  }

  const targetStage = input.data.stage ?? current.stage;
  if (!isProductionStage(targetStage)) throw new ProductionServiceError("INVALID_STAGE");
  const stageChanged = targetStage !== current.stage;
  if (stageChanged && !canTransitionProduction(input.actor.role, input.actor.userId, { ...current, stage: current.stage }, targetStage)) {
    throw new ProductionServiceError("INVALID_STAGE");
  }
  if (input.data.masterUserId !== undefined && input.data.masterUserId !== current.masterUserId && !canReassignProduction(input.actor.role)) {
    throw new ProductionServiceError("FORBIDDEN");
  }
  const plannedStartAt = input.data.plannedStartAt === undefined ? current.plannedStartAt : input.data.plannedStartAt;
  const plannedEndAt = input.data.plannedEndAt === undefined ? current.plannedEndAt : input.data.plannedEndAt;
  if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) throw new ProductionServiceError("INVALID_DATES");

  try {
    return await prisma.$transaction(async (tx) => {
      const fresh = await tx.production.findFirst({ where: { id: input.id, archivedAt: null, order: { deletedAt: null } } });
      if (!fresh || fresh.stage !== current.stage) throw new ProductionServiceError("INVALID_STAGE");

      const assigneeId = input.data.masterUserId ?? fresh.masterUserId;
      if (!assigneeId) throw new ProductionServiceError("INVALID_ASSIGNEE");
      const assignee = await getAssignee(tx, assigneeId, targetStage);
      const completed = isCompletedProductionStage(targetStage);
      const production = await tx.production.update({
        where: { id: input.id },
        data: {
          ...input.data,
          master: assignee.name,
          completedAt: completed ? fresh.completedAt ?? new Date() : null,
          actualEndAt: completed ? fresh.actualEndAt ?? new Date() : null,
          ...(stageChanged ? { percent: completed ? 100 : input.data.percent } : {}),
        },
        include: productionInclude,
      });
      if (stageChanged) {
        await tx.productionStageHistory.create({
          data: {
            productionId: input.id,
            fromStage: current.stage,
            toStage: targetStage,
            changedByUserId: input.actor.userId,
            comment: input.data.comment,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
          },
        });
      }
      await tx.orderEvent.create({
        data: {
          orderId: current.orderId,
          title: stageChanged ? "Этап производства изменён" : "Производство обновлено",
          description: `Этап: ${production.stage} • Готовность: ${production.percent}%`,
          user: input.actor.name,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        },
      });
      return production;
    });
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    const repeatedAfterRace = await prisma.orderEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!repeatedAfterRace || repeatedAfterRace.orderId !== current.orderId || !compareRequestHash(repeatedAfterRace.requestHash, input.requestHash)) {
      throw new ProductionServiceError("IDEMPOTENCY_CONFLICT");
    }
    return getProduction(input.id, input.actor);
  }
}

export async function deleteProductionCommand(id: number, actor: ProductionActor) {
  if (actor.role !== Role.DIRECTOR) throw new ProductionServiceError("FORBIDDEN");
  const current = await prisma.production.findUnique({ where: { id }, select: { id: true, orderId: true } });
  if (!current) return null;
  return prisma.$transaction(async (tx) => {
    await tx.production.delete({ where: { id } });
    await tx.orderEvent.create({
      data: { orderId: current.orderId, title: "Производство удалено", user: actor.name },
    });
    return { id };
  });
}

// Compatibility helpers for existing internal scripts; API writes use the command functions above.
export async function createProduction(data: { orderId: number; stage: string; percent: number; master: string; masterUserId?: number | null; comment?: string; startDate?: Date | null; finishDate?: Date | null }) {
  return prisma.production.create({ data: { ...data, masterUserId: data.masterUserId ?? null } });
}

export async function updateProduction(id: number, data: { stage?: string; percent?: number; master?: string; masterUserId?: number | null; comment?: string; startDate?: Date | null; finishDate?: Date | null }) {
  return prisma.production.update({ where: { id }, data });
}

export function assignMaster(id: number, master: string) {
  return prisma.production.update({ where: { id }, data: { master } });
}

export function updateStage(id: number, stage: string, percent: number) {
  return prisma.production.update({ where: { id }, data: { stage, percent } });
}

export async function getProductionStats() {
  const productions = await prisma.production.findMany({ where: { archivedAt: null, order: { deletedAt: null } } });
  return {
    total: productions.length,
    waiting: productions.filter((item) => item.stage === "Подготовка").length,
    working: productions.filter((item) => ["Каркас", "Дерево", "Комплектация"].includes(item.stage)).length,
    painting: productions.filter((item) => item.stage === "Покраска").length,
    installation: productions.filter((item) => item.stage === "Монтаж").length,
    completed: productions.filter((item) => item.stage === "Сдано").length,
    averagePercent: productions.length ? Math.round(productions.reduce((sum, item) => sum + item.percent, 0) / productions.length) : 0,
  };
}

export function deleteProduction(id: number) {
  return prisma.production.delete({ where: { id } });
}
