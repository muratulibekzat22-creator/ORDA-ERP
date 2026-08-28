import {
  CalendarTaskStatus,
  DocumentStatus,
  DocumentType,
  OrderLifecycle,
  Role,
} from "@prisma/client";

import { buildManagerOrderAttention } from "@/lib/orders/manager-attention";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export const MANAGER_MORNING_TIME_ZONE = "Asia/Almaty";

export function almatyBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANAGER_MORNING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const iso = `${value("year")}-${value("month")}-${value("day")}`;
  return { iso, date: new Date(`${iso}T00:00:00.000Z`) };
}

const activeOrderWhere = {
  deletedAt: null,
  lifecycle: { not: OrderLifecycle.CANCELLED },
} as const;

async function managerIdentity(managerUserId: number) {
  const manager = await prisma.user.findFirst({
    where: { id: managerUserId, role: Role.MANAGER, active: true },
    select: { id: true, name: true },
  });
  if (!manager) throw new Error("MANAGER_NOT_FOUND");
  return manager;
}

export async function getManagerMorningReviewState(
  managerUserId: number,
  now = new Date(),
) {
  const companyId = requireTenantIdentity().companyId;
  const manager = await managerIdentity(managerUserId);
  const businessDate = almatyBusinessDate(now);
  const ownWhere = {
    ...activeOrderWhere,
    OR: [
      { managerUserId },
      { leadConversion: { managerId: managerUserId } },
    ],
  };
  const [companyOrderCount, companyClientCount, legacyOrderCount, review, rows] =
    await Promise.all([
      prisma.order.count({ where: activeOrderWhere }),
      prisma.client.count({ where: { active: true, deletedAt: null } }),
      prisma.order.count({
        where: {
          ...activeOrderWhere,
          managerUserId: null,
          manager: { equals: manager.name, mode: "insensitive" },
        },
      }),
      prisma.managerDailyReview.findUnique({
        where: {
          companyId_managerUserId_businessDate: {
            companyId,
            managerUserId,
            businessDate: businessDate.date,
          },
        },
        select: {
          id: true,
          completedAt: true,
          inventoryOrderCount: true,
          actionOrderCount: true,
        },
      }),
      prisma.order.findMany({
        where: ownWhere,
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
          client: {
            select: {
              name: true,
              phone: true,
              city: true,
              address: true,
            },
          },
          documents: {
            where: {
              type: DocumentType.CONTRACT,
              status: {
                notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED],
              },
            },
            orderBy: [{ documentDate: "desc" }, { id: "desc" }],
            take: 1,
            select: { status: true },
          },
          calendarTasks: {
            where: {
              status: {
                in: [
                  CalendarTaskStatus.PLANNED,
                  CalendarTaskStatus.IN_PROGRESS,
                ],
              },
            },
            orderBy: [{ dueAt: "asc" }, { id: "asc" }],
            take: 1,
            select: { dueAt: true },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
      }),
    ]);

  const orders = rows
    .map((order) => {
      const contractStatus = order.documents[0]?.status ?? null;
      return buildManagerOrderAttention(
        {
          id: order.id,
          number: order.number,
          lifecycle: order.lifecycle,
          amount: Number(order.amount),
          promisedAt: order.promisedAt,
          address: order.address,
          staircase: order.staircase,
          material: order.material,
          contractConfirmed: Boolean(
            order.contractConfirmedAt || contractStatus === DocumentStatus.SIGNED,
          ),
          contractStatus,
          partnerAssigned: Boolean(order.partnerId),
          installationCompleted: order.installationCompleted,
          financialClosedAt: order.financialClosedAt,
          nextActionAt: order.calendarTasks[0]?.dueAt ?? null,
          client: order.client,
        },
        now,
      );
    })
    .sort(
      (left, right) =>
        left.statusOrder - right.statusOrder ||
        left.priority - right.priority ||
        left.id - right.id,
    );
  const inventoryHealthy = companyOrderCount > 0 || companyClientCount > 0;
  const ownershipRequired = orders.length === 0 && legacyOrderCount > 0;
  const bypassReason = !inventoryHealthy
    ? "EMPTY_TENANT_INVENTORY"
    : ownershipRequired
      ? "OWNERSHIP_REQUIRED"
      : orders.length === 0
        ? "NO_ASSIGNED_ORDERS"
        : null;

  return {
    businessDate: businessDate.iso,
    reviewedToday: Boolean(review),
    completedAt: review?.completedAt.toISOString() ?? null,
    mustReview: !review && !bypassReason && orders.length > 0,
    bypassReason,
    inventory: {
      companyOrderCount,
      companyClientCount,
      managerOrderCount: orders.length,
      legacyOrderCount,
      healthy: inventoryHealthy,
    },
    actionOrderCount: orders.filter((order) => order.requiresAction).length,
    orders,
  };
}

export async function completeManagerMorningReview(
  managerUserId: number,
  now = new Date(),
) {
  const companyId = requireTenantIdentity().companyId;
  const state = await getManagerMorningReviewState(managerUserId, now);
  if (state.bypassReason === "EMPTY_TENANT_INVENTORY")
    throw new Error("INVENTORY_UNAVAILABLE");
  if (state.bypassReason === "OWNERSHIP_REQUIRED")
    throw new Error("OWNERSHIP_REQUIRED");
  if (!state.inventory.managerOrderCount) return state;
  const businessDate = almatyBusinessDate(now);
  await prisma.managerDailyReview.upsert({
    where: {
      companyId_managerUserId_businessDate: {
        companyId,
        managerUserId,
        businessDate: businessDate.date,
      },
    },
    create: {
      managerUserId,
      businessDate: businessDate.date,
      inventoryOrderCount: state.inventory.managerOrderCount,
      actionOrderCount: state.actionOrderCount,
      completedAt: now,
    },
    update: {},
  });
  return getManagerMorningReviewState(managerUserId, now);
}

export async function getDirectorManagerOwnershipIssues() {
  const [orders, managers] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...activeOrderWhere,
        OR: [
          { managerUserId: null },
          { managerUser: { is: { active: false } } },
        ],
      },
      select: {
        id: true,
        number: true,
        manager: true,
        managerUserId: true,
        client: { select: { name: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
    }),
    prisma.user.findMany({
      where: { role: Role.MANAGER, active: true },
      select: { id: true, name: true },
    }),
  ]);
  const byName = new Map(
    managers.map((manager) => [manager.name.trim().toLocaleLowerCase("ru"), manager]),
  );
  return orders.map((order) => {
    const suggested = byName.get(order.manager.trim().toLocaleLowerCase("ru"));
    return {
      id: order.id,
      number: order.number,
      client: order.client.name,
      legacyManager: order.manager,
      managerUserId: order.managerUserId,
      suggestedManagerId: suggested?.id ?? null,
      suggestedManager: suggested?.name ?? null,
    };
  });
}
